package dev.mnm.plugin;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;

/**
 * Owns the connection to the backend: registration, heartbeats, ordered event
 * delivery with retry/backoff and (on proxies) periodic full syncs. All network
 * I/O runs on its own threads; platform callbacks must be thread-safe or hop to
 * the main thread themselves.
 */
public final class BackendConnector {

    /** Platform-specific data sources. */
    public interface Platform {
        /** "VELOCITY" or "PAPER". */
        String type();

        String platformVersion();

        String minecraftVersion();

        /** Heartbeat body without pluginVersion/platform fields; may complete on another thread. */
        CompletableFuture<JsonObject> heartbeat();

        /** Proxy only: currently connected sessions for /sync. */
        default Optional<JsonArray> sessions() {
            return Optional.empty();
        }
    }

    public record Status(boolean registered, boolean connected, String serverName, Instant lastSuccess, String lastError, int pendingEvents, long droppedEvents) {}

    private static final int BATCH_SIZE = 200;
    private static final long MAX_BACKOFF_MS = 60_000;

    private final Path dataDirectory;
    private final PluginConfig config;
    private final Platform platform;
    private final String pluginVersion;
    private final Logger logger;
    private final ScheduledExecutorService scheduler;
    private final ExecutorService io;
    private final BackendClient client;
    private final EventQueue queue;

    private final AtomicBoolean flushing = new AtomicBoolean();
    private final List<Runnable> periodicTasks = new java.util.concurrent.CopyOnWriteArrayList<>();
    private volatile Credentials credentials;
    private volatile boolean connected;
    private volatile boolean syncRequested = true;
    private volatile Instant lastSuccess;
    private volatile String lastError;
    private volatile long nextFlushAt;
    private volatile long backoffMs = 1000;

    public BackendConnector(Path dataDirectory, PluginConfig config, Platform platform, String pluginVersion, Logger logger) {
        this.dataDirectory = dataDirectory;
        this.config = config;
        this.platform = platform;
        this.pluginVersion = pluginVersion;
        this.logger = logger;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().name("mnm-scheduler").daemon().factory());
        this.io = Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("mnm-io-", 0).factory());
        this.client = new BackendClient(config.backendUrl(), "NetworkManager-" + platform.type() + "/" + pluginVersion, new Gson(), io);
        this.queue = new EventQueue(config.maxQueuedEvents());
    }

    public void start() {
        try {
            credentials = Credentials.load(dataDirectory).orElse(null);
        } catch (IOException e) {
            logger.error("Could not read {}: {}", Credentials.FILE_NAME, e.getMessage());
        }
        if (credentials != null) {
            client.useCredentials(credentials);
            logger.info("Using backend credentials for server \"{}\"", credentials.serverName());
            scheduleLoops();
        } else if (!config.registrationToken().isEmpty()) {
            register();
        } else {
            lastError = "Not registered";
            logger.error("Not registered with the backend. Create a registration token in the dashboard (Settings -> Minecraft Integration), set registration-token in {} and restart.", PluginConfig.FILE_NAME);
        }
    }

    private void register() {
        JsonObject body = new JsonObject();
        body.addProperty("token", config.registrationToken());
        body.addProperty("pluginVersion", pluginVersion);
        body.addProperty("platformVersion", platform.platformVersion());
        if (platform.minecraftVersion() != null) body.addProperty("minecraftVersion", platform.minecraftVersion());

        client.postUnsigned("/api/plugin/v1/register", body).whenComplete((response, error) -> {
            if (error != null) {
                BackendException e = unwrap(error);
                lastError = e.getMessage();
                if (e.status() == 401) {
                    logger.error("Registration token was rejected (invalid, expired or already used). Create a new token in the dashboard.");
                } else {
                    logger.warn("Registration failed ({}), retrying in 30 seconds", e.getMessage());
                    scheduler.schedule(this::register, 30, TimeUnit.SECONDS);
                }
                return;
            }
            Credentials issued = new Credentials(
                    response.get("keyId").getAsString(),
                    response.get("secret").getAsString(),
                    response.get("serverId").getAsString(),
                    response.get("serverName").getAsString());
            try {
                issued.save(dataDirectory);
            } catch (IOException ioError) {
                logger.error("Registered as \"{}\" but could not save {}: {}", issued.serverName(), Credentials.FILE_NAME, ioError.getMessage());
            }
            credentials = issued;
            client.useCredentials(issued);
            logger.info("Registered with the backend as \"{}\". The registration token is no longer needed and can be removed from {}.", issued.serverName(), PluginConfig.FILE_NAME);
            scheduleLoops();
        });
    }

    private void scheduleLoops() {
        scheduler.execute(this::heartbeat);
        scheduler.scheduleWithFixedDelay(this::heartbeat, config.heartbeatIntervalSeconds(), config.heartbeatIntervalSeconds(), TimeUnit.SECONDS);
        scheduler.scheduleWithFixedDelay(this::flush, 1, 1, TimeUnit.SECONDS);
        if (isProxy()) scheduler.scheduleWithFixedDelay(() -> syncRequested = true, config.syncIntervalSeconds(), config.syncIntervalSeconds(), TimeUnit.SECONDS);
        scheduler.scheduleWithFixedDelay(this::runPeriodicTasks, 0, 3, TimeUnit.SECONDS);
    }

    /** Registers work that runs every 3 seconds once the plugin is registered (e.g. the punishment feed). */
    public void every3Seconds(Runnable task) {
        periodicTasks.add(task);
    }

    /** Shared, signed HTTP client (for feature modules such as moderation). */
    public BackendClient client() {
        return client;
    }

    private void runPeriodicTasks() {
        for (Runnable task : periodicTasks) {
            try {
                task.run();
            } catch (RuntimeException e) {
                logger.warn("Periodic task failed: {}", e.getMessage());
            }
        }
    }

    /** Queues a player event; delivery is asynchronous and ordered. Safe to call from any thread. */
    public void enqueue(JsonObject event) {
        queue.add(event);
    }

    public Status status() {
        return new Status(credentials != null, connected, credentials == null ? null : credentials.serverName(), lastSuccess, lastError, queue.size(), queue.droppedTotal());
    }

    private void heartbeat() {
        if (credentials == null) return;
        platform.heartbeat()
                .thenCompose(body -> {
                    body.addProperty("pluginVersion", pluginVersion);
                    body.addProperty("platformVersion", platform.platformVersion());
                    if (platform.minecraftVersion() != null) body.addProperty("minecraftVersion", platform.minecraftVersion());
                    return client.post("/api/plugin/v1/heartbeat", body);
                })
                .whenComplete((ok, error) -> {
                    if (error == null) onSuccess();
                    else onFailure("heartbeat", unwrap(error));
                });
    }

    /** Sends the next batch (or a sync) unless one is in flight or we are backing off. */
    private void flush() {
        if (credentials == null || System.currentTimeMillis() < nextFlushAt || !flushing.compareAndSet(false, true)) return;
        try {
            if (queue.consumeOverflow()) {
                logger.warn("Event buffer overflowed ({} events dropped in total); a full sync will repair session state.", queue.droppedTotal());
                syncRequested = true;
            }
            CompletableFuture<?> work;
            if (isProxy() && syncRequested && queue.size() == 0) {
                work = sync();
            } else {
                List<JsonObject> batch = queue.peek(BATCH_SIZE);
                if (batch.isEmpty()) {
                    flushing.set(false);
                    return;
                }
                JsonObject body = new JsonObject();
                JsonArray events = new JsonArray();
                batch.forEach(events::add);
                body.add("events", events);
                work = client.post("/api/plugin/v1/events", body).thenAccept(response -> {
                    queue.acknowledge(batch);
                    if (config.debug()) logger.info("Delivered {} event(s): {}", batch.size(), response);
                }).exceptionally(error -> {
                    BackendException e = unwrap(error);
                    if (e.status() == 400) {
                        // A malformed event would block the queue forever: drop the batch and resync.
                        logger.error("Backend rejected {} event(s) as invalid ({}); dropping them and scheduling a sync.", batch.size(), e.getMessage());
                        queue.acknowledge(batch);
                        syncRequested = true;
                        return null;
                    }
                    throw e;
                });
            }
            work.whenComplete((ok, error) -> {
                flushing.set(false);
                if (error == null) onSuccess();
                else onFailure("event delivery", unwrap(error));
            });
        } catch (RuntimeException e) {
            flushing.set(false);
            onFailure("event delivery", unwrap(e));
        }
    }

    private CompletableFuture<?> sync() {
        JsonArray sessions = platform.sessions().orElseGet(JsonArray::new);
        JsonObject body = new JsonObject();
        body.add("sessions", sessions);
        return client.post("/api/plugin/v1/sync", body).thenAccept(result -> {
            syncRequested = false;
            if (config.debug()) logger.info("Synced {} session(s): {}", sessions.size(), result);
        });
    }

    private void onSuccess() {
        if (!connected) {
            logger.info("Connected to the backend");
            syncRequested = true;
        }
        connected = true;
        lastSuccess = Instant.now();
        lastError = null;
        backoffMs = 1000;
        nextFlushAt = 0;
    }

    private void onFailure(String what, BackendException e) {
        lastError = e.code() + ": " + e.getMessage();
        if (connected) logger.warn("Lost connection to the backend during {}: {}. Events are buffered ({} pending).", what, e.getMessage(), queue.size());
        else if (config.debug()) logger.warn("{} failed: {}", what, e.getMessage());
        if (e.isAuthenticationFailure()) {
            logger.error("The backend rejected this server's credentials ({}). If they were rotated or revoked, delete {} and register again with a new token.", e.code(), Credentials.FILE_NAME);
        } else if (e.status() == 403) {
            logger.error("The backend refused this server: {}", e.getMessage());
        }
        connected = false;
        nextFlushAt = System.currentTimeMillis() + backoffMs;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }

    /**
     * Graceful shutdown: tries to deliver queued events and tells the backend
     * the server is going offline. Blocks for at most {@code timeout}.
     */
    public void stop(Duration timeout) {
        scheduler.shutdownNow();
        if (credentials != null) {
            long deadline = System.nanoTime() + timeout.toNanos();
            try {
                while (queue.size() > 0 && System.nanoTime() < deadline) {
                    List<JsonObject> batch = queue.peek(BATCH_SIZE);
                    JsonObject body = new JsonObject();
                    JsonArray events = new JsonArray();
                    batch.forEach(events::add);
                    body.add("events", events);
                    client.post("/api/plugin/v1/events", body).get(remaining(deadline), TimeUnit.NANOSECONDS);
                    queue.acknowledge(batch);
                }
                client.post("/api/plugin/v1/shutdown", Map.of()).get(Math.max(remaining(deadline), TimeUnit.SECONDS.toNanos(1)), TimeUnit.NANOSECONDS);
            } catch (Exception e) {
                logger.warn("Could not notify the backend about the shutdown ({} event(s) undelivered): {}", queue.size(), e.getMessage());
            }
        }
        io.shutdownNow();
    }

    private boolean isProxy() {
        return "VELOCITY".equals(platform.type());
    }

    private static long remaining(long deadline) {
        return Math.max(1, deadline - System.nanoTime());
    }

    private static BackendException unwrap(Throwable error) {
        Throwable t = error;
        while (t.getCause() != null && !(t instanceof BackendException)) t = t.getCause();
        return t instanceof BackendException be ? be : new BackendException(t.getClass().getSimpleName() + ": " + t.getMessage(), t);
    }
}
