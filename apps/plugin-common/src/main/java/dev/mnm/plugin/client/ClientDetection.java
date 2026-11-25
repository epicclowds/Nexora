package dev.mnm.plugin.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;

/**
 * Client brand capture on the proxy: which brand events to send for which
 * session, and the dashboard settings (Settings → Minecraft integration →
 * Client detection) delivered with every heartbeat.
 *
 * <p>State is per session key, so a brand is never carried over into another
 * session; empty brands are ignored and a repeated brand (clients send it again
 * on server switches) is sent once.
 */
public final class ClientDetection {
    public static final int MAX_BRAND_LENGTH = 128;

    private final Logger logger;
    private final Map<UUID, String> sentBrands = new ConcurrentHashMap<>();
    private final Set<UUID> integrationReported = ConcurrentHashMap.newKeySet();
    private volatile boolean enabled = true;
    private volatile boolean debug;
    private volatile boolean norisk = true;

    public ClientDetection(Logger logger) {
        this.logger = logger;
    }

    /** Heartbeat response listener: reads {@code clientDetection} when present. */
    public void accept(JsonObject heartbeat) {
        JsonElement element = heartbeat.get("clientDetection");
        if (element == null || !element.isJsonObject()) return;
        JsonObject settings = element.getAsJsonObject();
        boolean wasDebug = debug;
        enabled = bool(settings, "enabled", true);
        debug = bool(settings, "debug", false);
        norisk = bool(settings, "norisk", true);
        if (debug != wasDebug) logger.info("Client detection debug logging {}", debug ? "enabled" : "disabled");
    }

    private static boolean bool(JsonObject o, String key, boolean fallback) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isBoolean() ? e.getAsBoolean() : fallback;
    }

    public boolean enabled() {
        return enabled;
    }

    public boolean debugEnabled() {
        return debug;
    }

    public boolean noriskEnabled() {
        return enabled && norisk;
    }

    /** Cleans a reported brand: trimmed, control characters removed, at most 128 characters; empty → null. */
    public static String clean(String raw) {
        if (raw == null) return null;
        String value = raw.replaceAll("\\p{Cntrl}", "").trim();
        if (value.isEmpty()) return null;
        return value.length() > MAX_BRAND_LENGTH ? value.substring(0, MAX_BRAND_LENGTH) : value;
    }

    /**
     * The brand to send for a session, or empty when nothing new should be sent
     * (detection off, empty brand, or the same brand as already sent).
     */
    public Optional<String> brandToSend(UUID sessionKey, String raw) {
        if (!enabled) return Optional.empty();
        String brand = clean(raw);
        if (brand == null) {
            debug("session {}: empty brand ignored", sessionKey);
            return Optional.empty();
        }
        String previous = sentBrands.put(sessionKey, brand);
        if (brand.equals(previous)) return Optional.empty();
        debug("session {}: brand \"{}\" received", sessionKey, brand);
        return Optional.of(brand);
    }

    /** Whether an integration result was already reported for this session (and marks it reported). */
    public boolean firstIntegrationReport(UUID sessionKey) {
        return integrationReported.add(sessionKey);
    }

    /** Whether a brand was sent for the session (debug: "no brand received"). */
    public boolean hasBrand(UUID sessionKey) {
        return sentBrands.containsKey(sessionKey);
    }

    public void sessionClosed(UUID sessionKey) {
        sentBrands.remove(sessionKey);
        integrationReported.remove(sessionKey);
    }

    /** Debug line (only when enabled in the dashboard). Never includes IP addresses. */
    public void debug(String message, Object... args) {
        if (!debug) return;
        logger.info("[client-detection] " + message, shortKeys(args));
    }

    /** Session keys are random; the first 8 characters identify a session in the logs. */
    private static Object[] shortKeys(Object[] args) {
        Object[] out = args.clone();
        for (int i = 0; i < out.length; i++) if (out[i] instanceof UUID uuid) out[i] = uuid.toString().substring(0, 8);
        return out;
    }
}
