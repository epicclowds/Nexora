package dev.mnm.plugin.punish;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.mnm.plugin.BackendClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Predicate;
import org.slf4j.Logger;

/**
 * Network-wide command mode and punishment reason presets, managed in the
 * dashboard (Settings → Moderation). Fetched when a heartbeat response reports
 * a new {@code moderationRevision}, so changes apply without restarts. The
 * backend makes the final decision for every punishment; this cache only
 * drives tab completion, /nexora reasons and early error messages.
 */
public final class ReasonCatalog {
    public enum Mode { PRESET_ONLY, FREE_TEXT, HYBRID }

    /** A reason preset. {@code numericId} is the reason ID used in commands, not a punishment ID. */
    public record Preset(String category, int numericId, String name, String reason, Long durationSeconds, boolean permanent, String permission) {}

    private final BackendClient client;
    private final Logger logger;
    private final AtomicBoolean fetching = new AtomicBoolean();
    private volatile Mode mode;
    private volatile List<Preset> presets = List.of();
    private volatile long revision = -1;

    public ReasonCatalog(BackendClient client, Logger logger) {
        this.client = client;
        this.logger = logger;
    }

    /** Heartbeat listener: refreshes when the revision changed. */
    public void accept(JsonObject heartbeat) {
        if (heartbeat == null || !heartbeat.has("moderationRevision")) return;
        long next = heartbeat.get("moderationRevision").getAsLong();
        if (next == revision || !fetching.compareAndSet(false, true)) return;
        client.get("/api/plugin/v1/moderation").whenComplete((catalog, error) -> {
            fetching.set(false);
            if (error != null) logger.warn("Could not load punishment reasons: {}", error.getMessage());
            else apply(catalog);
        });
    }

    public void apply(JsonObject catalog) {
        List<Preset> list = new ArrayList<>();
        for (JsonElement e : catalog.getAsJsonArray("presets")) {
            JsonObject p = e.getAsJsonObject();
            list.add(new Preset(
                    p.get("category").getAsString(),
                    p.get("numericId").getAsInt(),
                    p.get("name").getAsString(),
                    p.get("reason").getAsString(),
                    p.get("durationSeconds").isJsonNull() ? null : p.get("durationSeconds").getAsLong(),
                    p.get("permanent").getAsBoolean(),
                    p.get("permission").getAsString()));
        }
        presets = List.copyOf(list);
        try {
            mode = Mode.valueOf(catalog.get("mode").getAsString());
        } catch (IllegalArgumentException e) {
            mode = null;
        }
        revision = catalog.has("revision") ? catalog.get("revision").getAsLong() : revision;
    }

    /** The mode, or null while unknown (before the first successful fetch; the backend decides then). */
    public Mode mode() {
        return mode;
    }

    public boolean presetsAllowed() {
        return mode != Mode.FREE_TEXT;
    }

    public Optional<Preset> find(String category, int numericId) {
        return presets.stream().filter(p -> p.category().equals(category) && p.numericId() == numericId).findFirst();
    }

    /** Usable presets of a category for a permission check (e.g. the command sender's). */
    public List<Preset> usable(String category, Predicate<String> hasPermission) {
        if (mode == Mode.FREE_TEXT) return List.of();
        return presets.stream().filter(p -> p.category().equals(category) && hasPermission.test(p.permission())).toList();
    }

    /** "ban" → "BAN" etc. for the command kinds that support reason IDs. */
    public static String categoryOf(String punishmentType) {
        return switch (punishmentType.toUpperCase(Locale.ROOT)) {
            case "BAN", "TEMP_BAN" -> "BAN";
            case "MUTE", "TEMP_MUTE" -> "MUTE";
            case "KICK" -> "KICK";
            case "WARNING", "WARN" -> "WARN";
            default -> null;
        };
    }
}
