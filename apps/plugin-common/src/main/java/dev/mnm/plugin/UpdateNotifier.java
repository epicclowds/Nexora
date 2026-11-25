package dev.mnm.plugin;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;

/**
 * Update information for staff. The backend checks GitHub and sends the cached
 * result with every heartbeat response; this class never contacts GitHub,
 * never downloads anything and never blocks a server thread.
 *
 * <p>Notifications go only to players with {@link #NOTIFY_PERMISSION}, at most
 * once per cooldown (set in the dashboard) per player – joining again or
 * switching servers does not repeat them.
 */
public final class UpdateNotifier {
    public static final String NOTIFY_PERMISSION = "networkmanager.update.notify";
    public static final String CHECK_PERMISSION = "networkmanager.update.check";

    /** Cached backend data. checkedAt = last successful GitHub check (may be null). */
    public record Info(String latestVersion, String installedVersion, boolean updateAvailable, String releaseUrl, Instant checkedAt, boolean notificationsEnabled, long cooldownMinutes, Instant receivedAt) {}

    private final Messages messages;
    private final String pluginVersion;
    private final boolean enabledHere;
    private final Map<UUID, Instant> lastNotified = new ConcurrentHashMap<>();
    private volatile Info info;
    private volatile boolean disabledByBackend;

    /**
     * @param setting the local {@code update-notifications} value: {@code true}, {@code false}
     *     or {@code auto} (= {@code proxyDefault})
     */
    public UpdateNotifier(Messages messages, String pluginVersion, String setting, boolean proxyDefault) {
        this.messages = messages;
        this.pluginVersion = pluginVersion;
        this.enabledHere = switch (setting == null ? "auto" : setting.trim().toLowerCase(Locale.ROOT)) {
            case "true" -> true;
            case "false" -> false;
            default -> proxyDefault;
        };
    }

    /** Called with every successful heartbeat response. A missing field keeps the last known data. */
    public void accept(JsonObject heartbeatResponse) {
        if (heartbeatResponse == null || !heartbeatResponse.has("update")) return;
        JsonElement element = heartbeatResponse.get("update");
        if (element == null || element.isJsonNull()) {
            // Update checks are disabled or nothing is known yet: stay silent.
            info = null;
            disabledByBackend = true;
            return;
        }
        if (!element.isJsonObject()) return;
        JsonObject u = element.getAsJsonObject();
        String latest = string(u, "latestVersion");
        if (latest == null) return;
        String url = string(u, "releaseUrl");
        info = new Info(
                latest,
                pluginVersion,
                u.has("updateAvailable") && u.get("updateAvailable").getAsBoolean(),
                url != null && url.startsWith("https://") ? url : null,
                instant(string(u, "checkedAt")),
                !u.has("notify") || u.get("notify").getAsBoolean(),
                u.has("cooldownMinutes") ? Math.max(1, u.get("cooldownMinutes").getAsLong()) : 1440,
                Instant.now());
        disabledByBackend = false;
    }

    public Info info() {
        return info;
    }

    /** True when this player should get the join notification now (records the time if so). */
    public boolean shouldNotify(UUID player, boolean hasPermission, Instant now) {
        Info current = info;
        if (!enabledHere || !hasPermission || current == null || !current.notificationsEnabled() || !current.updateAvailable()) return false;
        Instant last = lastNotified.get(player);
        if (last != null && Duration.between(last, now).toMinutes() < current.cooldownMinutes()) return false;
        lastNotified.put(player, now);
        return true;
    }

    /** The join notification. */
    public List<Component> notificationLines() {
        Info current = info;
        List<Component> lines = new ArrayList<>();
        if (current == null) return lines;
        lines.add(messages.prefixed("update.available", Map.of()));
        lines.add(messages.render("update.current-version", Map.of("version", current.installedVersion())));
        lines.add(messages.render("update.latest-version", Map.of("version", current.latestVersion())));
        if (current.releaseUrl() != null) lines.add(link("update.download", current.releaseUrl()));
        return lines;
    }

    /** Output of {@code /networkmanager update} (cached data with its age; never a live GitHub request). */
    public List<Component> infoLines(Instant now) {
        Info current = info;
        List<Component> lines = new ArrayList<>();
        lines.add(messages.prefixed("update.info-title", Map.of()));
        lines.add(messages.render("update.installed", Map.of("version", pluginVersion)));
        if (current == null) {
            lines.add(messages.render(disabledByBackend ? "update.unavailable" : "update.no-data", Map.of()));
            return lines;
        }
        lines.add(messages.render("update.latest", Map.of("version", current.latestVersion())));
        lines.add(messages.render(current.updateAvailable() ? "update.status-available" : "update.status-current", Map.of()));
        lines.add(messages.render("update.checked", Map.of("time", current.checkedAt() == null ? "-" : ago(current.checkedAt(), now))));
        if (current.releaseUrl() != null) lines.add(link("update.release", current.releaseUrl()));
        return lines;
    }

    private Component link(String key, String url) {
        return messages.render(key, Map.of("url", url)).clickEvent(ClickEvent.openUrl(url));
    }

    static String ago(Instant then, Instant now) {
        long minutes = Math.max(0, Duration.between(then, now).toMinutes());
        if (minutes < 60) return minutes + "m";
        if (minutes < 48 * 60) return (minutes / 60) + "h";
        return (minutes / 1440) + "d";
    }

    private static String string(JsonObject o, String key) {
        return o.has(key) && o.get(key).isJsonPrimitive() ? o.get(key).getAsString() : null;
    }

    private static Instant instant(String value) {
        if (value == null) return null;
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
