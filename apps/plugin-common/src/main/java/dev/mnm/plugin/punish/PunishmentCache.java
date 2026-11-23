package dev.mnm.plugin.punish;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thread-safe local copy of all active bans, blacklists and mutes. Login and
 * chat checks read only from here, so they never wait on the network and keep
 * working while the backend is unreachable. The cache is persisted to disk so a
 * restart during an outage still enforces punishments.
 */
public final class PunishmentCache {
    public static final String FILE_NAME = "punishments-cache.json";
    private static final Gson GSON = new GsonBuilder().serializeNulls().create();

    private final Map<String, CachedPunishment> byId = new ConcurrentHashMap<>();
    private volatile String cursor;

    /** Active ban or blacklist matching the account or (blacklist only) the IP address. */
    public Optional<CachedPunishment> findBan(UUID player, String ip, long now) {
        return byId.values().stream()
                .filter(p -> p.isBan() && p.isActive(now))
                .filter(p -> p.targetUuid().equals(player) || (ip != null && "BLACKLIST".equals(p.type()) && ip.equals(p.targetIp())))
                .findFirst();
    }

    public Optional<CachedPunishment> findMute(UUID player, long now) {
        return byId.values().stream().filter(p -> p.isMute() && p.isActive(now) && p.targetUuid().equals(player)).findFirst();
    }

    public void replaceAll(Collection<CachedPunishment> punishments, String newCursor) {
        byId.clear();
        punishments.stream().filter(CachedPunishment::isEnforceable).forEach(p -> byId.put(p.id(), p));
        cursor = newCursor;
    }

    public void put(CachedPunishment punishment) {
        if (punishment.isEnforceable()) byId.put(punishment.id(), punishment);
    }

    public void remove(String id) {
        byId.remove(id);
    }

    /** Drops expired entries (they are not enforced anyway; this keeps the file small). */
    public void prune(long now) {
        byId.values().removeIf(p -> !p.isActive(now));
    }

    public String cursor() {
        return cursor;
    }

    public void setCursor(String cursor) {
        this.cursor = cursor;
    }

    public int size() {
        return byId.size();
    }

    public List<CachedPunishment> all() {
        return List.copyOf(byId.values());
    }

    public void save(Path dataDirectory) throws IOException {
        JsonObject root = new JsonObject();
        root.addProperty("cursor", cursor);
        JsonArray list = new JsonArray();
        byId.values().forEach(p -> list.add(p.toJson()));
        root.add("punishments", list);
        Files.createDirectories(dataDirectory);
        Path temp = Files.createTempFile(dataDirectory, "punishments", ".tmp");
        try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            GSON.toJson(root, writer);
        }
        Files.move(temp, dataDirectory.resolve(FILE_NAME), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    /** Loads a previously saved cache; returns false if there is none or it is unreadable. */
    public boolean load(Path dataDirectory) {
        Path file = dataDirectory.resolve(FILE_NAME);
        if (!Files.exists(file)) return false;
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
            byId.clear();
            for (JsonElement e : root.getAsJsonArray("punishments")) put(CachedPunishment.fromJson(e.getAsJsonObject()));
            cursor = root.has("cursor") && !root.get("cursor").isJsonNull() ? root.get("cursor").getAsString() : null;
            return true;
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }
}
