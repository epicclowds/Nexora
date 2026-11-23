package dev.mnm.paper.anticheat;

import com.google.gson.JsonObject;
import dev.mnm.paper.api.AntiCheatApi;
import dev.mnm.paper.api.AntiCheatReport;
import dev.mnm.paper.api.ReportResult;
import dev.mnm.plugin.BackendClient;
import dev.mnm.plugin.BackendException;
import dev.mnm.plugin.punish.PunishmentTexts;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.slf4j.Logger;

/**
 * Implementation of {@link AntiCheatApi}. Authorises integrations, rate limits
 * them, forwards reports to the backend (which applies the network's rules)
 * and disconnects the player locally when a kick or ban was issued, so they do
 * not keep playing until the proxy picks the punishment up.
 */
public final class AntiCheatBridge implements AntiCheatApi {
    private static final int MAX_ATTEMPTS = 3;
    private static final Set<String> DISCONNECTING = Set.of("KICK", "TEMP_BAN", "BAN");

    private final Plugin owner;
    private final BackendClient client;
    private final Set<String> integrations;
    private final RateLimiter limiter;
    private final PunishmentTexts texts;
    private final Logger logger;

    public AntiCheatBridge(Plugin owner, BackendClient client, Set<String> integrations, int maxReportsPerMinute, PunishmentTexts texts, Logger logger) {
        this.owner = owner;
        this.client = client;
        this.integrations = integrations;
        this.limiter = new RateLimiter(maxReportsPerMinute, 60_000);
        this.texts = texts;
        this.logger = logger;
    }

    @Override
    public boolean isAuthorized(Plugin integration) {
        return integration != null && integrations.contains(integration.getName().toLowerCase(Locale.ROOT));
    }

    @Override
    public CompletableFuture<ReportResult> report(Plugin integration, AntiCheatReport report) {
        if (!isAuthorized(integration)) {
            logger.warn("Rejected AntiCheat report from unauthorised plugin {} (add it to anticheat-integrations)", integration == null ? "null" : integration.getName());
            return CompletableFuture.failedFuture(new SecurityException("Plugin is not an authorised AntiCheat integration"));
        }
        return submit(integration.getName(), report.player().toString(), report, false);
    }

    /** Explicit request from /anticheatban (provider = command sender description). */
    public CompletableFuture<ReportResult> command(String provider, String target, String cheatType, String reason) {
        return submit(provider, target, new AntiCheatReport(new UUID(0, 0), cheatType, null, reason, null, Map.of()), true);
    }

    private CompletableFuture<ReportResult> submit(String provider, String target, AntiCheatReport report, boolean explicit) {
        if (!limiter.tryAcquire(provider.toLowerCase(Locale.ROOT))) {
            logger.warn("AntiCheat report from {} dropped: rate limit exceeded", provider);
            return CompletableFuture.completedFuture(new ReportResult("SKIPPED_RATE_LIMIT", null));
        }
        JsonObject body = new JsonObject();
        body.addProperty("target", target);
        body.addProperty("provider", provider.replaceAll("[^A-Za-z0-9 _.-]", "").isBlank() ? "Unknown" : provider.replaceAll("[^A-Za-z0-9 _.-]", ""));
        body.addProperty("cheatType", report.cheatType());
        if (report.violationLevel() != null) body.addProperty("violationLevel", report.violationLevel());
        if (report.reason() != null && !report.reason().isBlank()) body.addProperty("reason", report.reason());
        if (report.evidence() != null) body.addProperty("evidence", report.evidence());
        if (!report.metadata().isEmpty()) {
            JsonObject meta = new JsonObject();
            report.metadata().forEach((k, v) -> {
                if (v instanceof Number n) meta.addProperty(k, n);
                else if (v instanceof Boolean b) meta.addProperty(k, b);
                else meta.addProperty(k, String.valueOf(v));
            });
            body.add("metadata", meta);
        }
        body.addProperty("explicit", explicit);
        // Same key on every retry: the backend never punishes twice for one report.
        body.addProperty("eventKey", UUID.randomUUID().toString());
        return send(body, 1).thenApply(response -> {
            ReportResult result = new ReportResult(response.get("outcome").getAsString(), response.get("punishmentId").isJsonNull() ? null : response.get("punishmentId").getAsString());
            if (DISCONNECTING.contains(result.outcome())) disconnectLocally(target, report.reason() != null ? report.reason() : "[AntiCheat] " + report.cheatType());
            return result;
        });
    }

    private CompletableFuture<JsonObject> send(JsonObject body, int attempt) {
        return client.post("/api/plugin/v1/anticheat/reports", body).handle((response, error) -> {
            if (error == null) return CompletableFuture.completedFuture(response);
            Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
            boolean retryable = !(cause instanceof BackendException be) || be.status() == 0 || be.status() >= 500;
            if (retryable && attempt < MAX_ATTEMPTS) {
                Executor delayed = CompletableFuture.delayedExecutor((long) Math.pow(4, attempt - 1), TimeUnit.SECONDS);
                return CompletableFuture.supplyAsync(() -> body, delayed).thenCompose(b -> send(b, attempt + 1));
            }
            return CompletableFuture.<JsonObject>failedFuture(cause);
        }).thenCompose(f -> f);
    }

    private void disconnectLocally(String target, String reason) {
        if (!owner.isEnabled()) return;
        Bukkit.getScheduler().runTask(owner, () -> {
            Player player;
            try {
                player = Bukkit.getPlayer(UUID.fromString(target));
            } catch (IllegalArgumentException notUuid) {
                player = Bukkit.getPlayerExact(target);
            }
            if (player != null) player.kick(texts.kickScreen(reason));
        });
    }

    /** Fixed-window limiter per integration. */
    static final class RateLimiter {
        private final int limit;
        private final long windowMillis;
        private final Map<String, long[]> windows = new ConcurrentHashMap<>();

        RateLimiter(int limit, long windowMillis) {
            this.limit = limit;
            this.windowMillis = windowMillis;
        }

        boolean tryAcquire(String key) {
            long now = System.currentTimeMillis();
            long[] window = windows.computeIfAbsent(key, k -> new long[] {now, 0});
            synchronized (window) {
                if (now - window[0] >= windowMillis) {
                    window[0] = now;
                    window[1] = 0;
                }
                if (window[1] >= limit) return false;
                window[1]++;
                return true;
            }
        }
    }
}
