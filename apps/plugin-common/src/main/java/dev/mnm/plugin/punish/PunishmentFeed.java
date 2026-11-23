package dev.mnm.plugin.punish;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.mnm.plugin.BackendClient;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;

/**
 * Keeps the {@link PunishmentCache} current by polling the backend's ordered
 * change feed. New punishments are also handed to a {@link Listener} so the
 * platform can kick, disconnect or notify players. Changes older than
 * {@link #ACTION_WINDOW_MS} (e.g. replayed after a long outage) only update the
 * cache and trigger no player-facing action.
 */
public final class PunishmentFeed {
    public static final long ACTION_WINDOW_MS = 120_000;

    public interface Listener {
        void created(CachedPunishment punishment);

        default void revoked(CachedPunishment punishment) {}
    }

    private final BackendClient client;
    private final PunishmentCache cache;
    private final Path dataDirectory;
    private final Listener listener;
    private final Logger logger;
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile boolean synced;

    public PunishmentFeed(BackendClient client, PunishmentCache cache, Path dataDirectory, Listener listener, Logger logger) {
        this.client = client;
        this.cache = cache;
        this.dataDirectory = dataDirectory;
        this.listener = listener;
        this.logger = logger;
        if (cache.load(dataDirectory)) logger.info("Loaded {} cached punishment(s) for offline enforcement", cache.size());
    }

    public boolean isSynced() {
        return synced;
    }

    /** Called periodically by the connector. Overlapping calls are skipped. */
    public CompletableFuture<Void> poll() {
        if (!client.hasCredentials() || !running.compareAndSet(false, true)) return CompletableFuture.completedFuture(null);
        CompletableFuture<Void> work = synced ? pollChanges() : loadSnapshot();
        // Failures are retried on the next poll; the cache keeps enforcing meanwhile.
        return work.whenComplete((ok, error) -> running.set(false));
    }

    /** Full snapshot on startup (replaces the disk cache). */
    private CompletableFuture<Void> loadSnapshot() {
        return client.get("/api/plugin/v1/punishments/active").thenAccept(body -> {
            List<CachedPunishment> list = new ArrayList<>();
            for (JsonElement e : body.getAsJsonArray("punishments")) list.add(CachedPunishment.fromJson(e.getAsJsonObject()));
            cache.replaceAll(list, body.get("cursor").getAsString());
            synced = true;
            persist();
            logger.info("Punishment cache synchronised ({} active)", list.size());
        });
    }

    private CompletableFuture<Void> pollChanges() {
        return client.get("/api/plugin/v1/punishments/changes?after=" + cache.cursor()).thenCompose(body -> {
            var changes = body.getAsJsonArray("changes");
            long now = System.currentTimeMillis();
            for (JsonElement e : changes) {
                JsonObject change = e.getAsJsonObject();
                CachedPunishment p = CachedPunishment.fromJson(change.getAsJsonObject("punishment"));
                boolean recent = now - change.get("at").getAsLong() <= ACTION_WINDOW_MS;
                if ("REVOKED".equals(change.get("kind").getAsString())) {
                    cache.remove(p.id());
                    if (recent) safely(() -> listener.revoked(p));
                } else {
                    cache.put(p);
                    if (recent) safely(() -> listener.created(p));
                }
            }
            cache.setCursor(body.get("cursor").getAsString());
            if (!changes.isEmpty()) {
                cache.prune(now);
                persist();
            }
            return body.get("hasMore").getAsBoolean() ? pollChanges() : CompletableFuture.completedFuture(null);
        });
    }

    private void safely(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException e) {
            logger.warn("Punishment action failed: {}", e.getMessage());
        }
    }

    private void persist() {
        try {
            cache.save(dataDirectory);
        } catch (IOException e) {
            logger.warn("Could not persist the punishment cache: {}", e.getMessage());
        }
    }
}
