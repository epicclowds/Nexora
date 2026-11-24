package dev.mnm.plugin;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;

/**
 * Effective settings: values managed in the dashboard override the local
 * {@code config.properties}; a missing/null remote value keeps the local one.
 * The last remote document is cached in {@code managed-settings.json} so it
 * also applies when the plugin starts while the backend is unreachable.
 * Thread-safe; listeners run on the thread that applied the update.
 */
public final class ManagedSettings {
    public static final String CACHE_FILE = "managed-settings.json";

    private final PluginConfig local;
    private final Path cacheFile;
    private final Logger logger;
    private final List<Runnable> listeners = new CopyOnWriteArrayList<>();
    private volatile JsonObject remote = new JsonObject();
    private volatile long revision = -1;

    public ManagedSettings(PluginConfig local, Path dataDirectory, Logger logger) {
        this.local = local;
        this.cacheFile = dataDirectory.resolve(CACHE_FILE);
        this.logger = logger;
        if (local.managedSettings() && Files.exists(cacheFile)) {
            try {
                JsonObject cached = JsonParser.parseString(Files.readString(cacheFile, StandardCharsets.UTF_8)).getAsJsonObject();
                remote = cached;
                revision = cached.has("revision") ? cached.get("revision").getAsLong() : -1;
            } catch (IOException | RuntimeException e) {
                logger.warn("Ignoring unreadable {}: {}", CACHE_FILE, e.getMessage());
            }
        }
    }

    public boolean enabled() {
        return local.managedSettings();
    }

    /** Revision of the applied remote settings (-1 = none yet). */
    public long revision() {
        return revision;
    }

    public void onChange(Runnable listener) {
        listeners.add(listener);
    }

    /** Applies a document from {@code GET /api/plugin/v1/config}. */
    public void apply(JsonObject config) {
        if (!local.managedSettings()) return;
        long next = config.has("revision") ? config.get("revision").getAsLong() : 0;
        if (next == revision) return;
        remote = config;
        revision = next;
        try {
            Path tmp = cacheFile.resolveSibling(CACHE_FILE + ".tmp");
            Files.writeString(tmp, config.toString(), StandardCharsets.UTF_8);
            Files.move(tmp, cacheFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            logger.warn("Could not cache managed settings: {}", e.getMessage());
        }
        logger.info("Applied managed settings revision {} from the dashboard", next);
        for (Runnable listener : listeners) {
            try {
                listener.run();
            } catch (RuntimeException e) {
                logger.warn("Applying managed settings failed: {}", e.getMessage());
            }
        }
    }

    /** Keeps plugin messages in sync with the managed language and overrides (applies immediately). */
    public void bind(Messages messages) {
        Runnable update = () -> {
            String locale = language();
            try {
                messages.apply(locale, messageOverrides(locale));
            } catch (IOException e) {
                logger.warn("Could not load messages for {}: {}", locale, e.getMessage());
            }
        };
        update.run();
        onChange(update);
    }

    // ── Effective values ─────────────────────────────────────────

    public String language() {
        String value = string("language");
        return value != null && value.matches("[a-z]{2,3}-[A-Z]{2}") ? value : local.language();
    }

    /** Message overrides for the given locale (empty when none). */
    public Map<String, String> messageOverrides(String locale) {
        JsonElement messages = field("messages");
        if (messages == null || !messages.isJsonObject()) return Map.of();
        JsonElement entries = messages.getAsJsonObject().get(locale);
        if (entries == null || !entries.isJsonObject()) return Map.of();
        Map<String, String> out = new HashMap<>();
        entries.getAsJsonObject().entrySet().forEach(e -> {
            if (e.getValue().isJsonPrimitive()) out.put(e.getKey(), e.getValue().getAsString());
        });
        return Collections.unmodifiableMap(out);
    }

    /** Appeal link for ban screens (managed value, else config.properties appeal-url). */
    public String appealUrl() {
        String value = string("appealUrl");
        return value != null ? PluginConfig.appealUrl(value) : local.appealUrl();
    }

    public boolean statisticsEnabled() {
        return bool("statisticsEnabled", local.statisticsEnabled());
    }

    public Set<String> statisticsCategories() {
        JsonElement value = field("statisticsCategories");
        if (value == null || !value.isJsonArray()) return local.statisticsCategories();
        Set<String> out = new TreeSet<>();
        value.getAsJsonArray().forEach(e -> {
            String c = e.getAsString().toLowerCase(Locale.ROOT);
            if (PluginConfig.STATISTIC_CATEGORIES.contains(c)) out.add(c);
        });
        return Collections.unmodifiableSet(out);
    }

    public int statisticsIntervalSeconds() {
        return integer("statisticsIntervalSeconds", local.statisticsIntervalSeconds(), 60, 3600);
    }

    public boolean inventorySync() {
        return bool("inventorySync", local.inventorySync());
    }

    public boolean enderChestSync() {
        return bool("enderChestSync", local.enderChestSync());
    }

    public int inventorySyncIntervalSeconds() {
        return integer("inventorySyncIntervalSeconds", local.inventorySyncIntervalSeconds(), 30, 3600);
    }

    private JsonElement field(String name) {
        if (!local.managedSettings()) return null;
        JsonElement value = remote.get(name);
        return value == null || value.isJsonNull() ? null : value;
    }

    private String string(String name) {
        JsonElement value = field(name);
        return value != null && value.isJsonPrimitive() ? value.getAsString() : null;
    }

    private boolean bool(String name, boolean fallback) {
        JsonElement value = field(name);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() ? value.getAsBoolean() : fallback;
    }

    private int integer(String name, int fallback, int min, int max) {
        JsonElement value = field(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return fallback;
        return Math.max(min, Math.min(max, value.getAsInt()));
    }
}
