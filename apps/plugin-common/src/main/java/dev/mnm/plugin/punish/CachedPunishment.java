package dev.mnm.plugin.punish;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.UUID;

/** Enforceable punishment as delivered by the backend feed. */
public record CachedPunishment(
        String id,
        String type,
        UUID targetUuid,
        String targetName,
        String targetIp,
        String reason,
        String issuerName,
        long createdAt,
        Long expiresAt) {

    public boolean isBan() {
        return type.equals("BAN") || type.equals("TEMP_BAN") || type.equals("BLACKLIST");
    }

    public boolean isMute() {
        return type.equals("MUTE") || type.equals("TEMP_MUTE");
    }

    public boolean isEnforceable() {
        return isBan() || isMute();
    }

    public boolean isPermanent() {
        return expiresAt == null;
    }

    public boolean isActive(long now) {
        return expiresAt == null || expiresAt > now;
    }

    public static CachedPunishment fromJson(JsonObject o) {
        return new CachedPunishment(
                o.get("id").getAsString(),
                o.get("type").getAsString(),
                UUID.fromString(o.get("targetUuid").getAsString()),
                string(o.get("targetName")),
                string(o.get("targetIp")),
                string(o.get("reason")),
                string(o.get("issuerName")),
                o.get("createdAt").getAsLong(),
                o.has("expiresAt") && !o.get("expiresAt").isJsonNull() ? o.get("expiresAt").getAsLong() : null);
    }

    public JsonObject toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("id", id);
        o.addProperty("type", type);
        o.addProperty("targetUuid", targetUuid.toString());
        o.addProperty("targetName", targetName);
        o.addProperty("targetIp", targetIp);
        o.addProperty("reason", reason);
        o.addProperty("issuerName", issuerName);
        o.addProperty("createdAt", createdAt);
        o.addProperty("expiresAt", expiresAt);
        return o;
    }

    private static String string(JsonElement e) {
        return e == null || e.isJsonNull() ? null : e.getAsString();
    }
}
