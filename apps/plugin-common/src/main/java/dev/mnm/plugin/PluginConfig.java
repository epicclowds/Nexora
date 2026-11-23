package dev.mnm.plugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Objects;
import java.util.Properties;

/** {@code config.properties} in the plugin data folder. Created from the bundled default on first start. */
public record PluginConfig(
        URI backendUrl,
        String registrationToken,
        String language,
        boolean collectIpAddresses,
        int heartbeatIntervalSeconds,
        int syncIntervalSeconds,
        int maxQueuedEvents,
        boolean debug) {

    public static final String FILE_NAME = "config.properties";

    public static PluginConfig loadOrCreate(Path dataDirectory, ClassLoader resources) throws IOException {
        Files.createDirectories(dataDirectory);
        Path file = dataDirectory.resolve(FILE_NAME);
        if (!Files.exists(file)) {
            try (InputStream in = Objects.requireNonNull(resources.getResourceAsStream(FILE_NAME), "bundled config.properties missing")) {
                Files.copy(in, file);
            }
        }
        Properties p = new Properties();
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            p.load(reader);
        }
        return fromProperties(p);
    }

    static PluginConfig fromProperties(Properties p) {
        return new PluginConfig(
                parseBackendUrl(p.getProperty("backend-url", "").trim()),
                p.getProperty("registration-token", "").trim(),
                p.getProperty("language", "en-US").trim(),
                bool(p, "collect-ip-addresses", true),
                clamp(integer(p, "heartbeat-interval-seconds", 15), 5, 300),
                clamp(integer(p, "sync-interval-seconds", 60), 15, 3600),
                clamp(integer(p, "max-queued-events", 50_000), 1_000, 1_000_000),
                bool(p, "debug", false));
    }

    /** The backend URL is the dashboard address; the API lives under /api. Paths are not supported. */
    static URI parseBackendUrl(String raw) {
        if (raw.isEmpty()) throw new IllegalArgumentException("backend-url is not set in " + FILE_NAME);
        try {
            URI uri = new URI(raw.endsWith("/") ? raw.substring(0, raw.length() - 1) : raw);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) throw new IllegalArgumentException("backend-url must start with http:// or https://");
            if (uri.getHost() == null) throw new IllegalArgumentException("backend-url has no host");
            if (uri.getRawPath() != null && !uri.getRawPath().isEmpty()) throw new IllegalArgumentException("backend-url must not contain a path");
            return uri;
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("backend-url is not a valid URL: " + raw, e);
        }
    }

    private static boolean bool(Properties p, String key, boolean fallback) {
        String v = p.getProperty(key);
        return v == null || v.isBlank() ? fallback : Boolean.parseBoolean(v.trim());
    }

    private static int integer(Properties p, String key, int fallback) {
        try {
            return Integer.parseInt(p.getProperty(key, String.valueOf(fallback)).trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
