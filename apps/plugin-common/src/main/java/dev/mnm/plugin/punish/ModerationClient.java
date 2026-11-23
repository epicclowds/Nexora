package dev.mnm.plugin.punish;

import com.google.gson.JsonObject;
import dev.mnm.plugin.BackendClient;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Backend calls behind the in-game moderation commands. All methods are asynchronous. */
public final class ModerationClient {
    /** Issuer/revoker of a command; {@code uuid == null} means the console. */
    public record Actor(UUID uuid, String name) {
        public static Actor console() {
            return new Actor(null, "console");
        }

        JsonObject toJson() {
            JsonObject o = new JsonObject();
            if (uuid != null) o.addProperty("uuid", uuid.toString());
            o.addProperty("name", name);
            return o;
        }
    }

    private final BackendClient client;

    public ModerationClient(BackendClient client) {
        this.client = client;
    }

    /**
     * Issues a punishment. A fresh idempotency key per invocation makes the
     * request safe to retry without creating duplicates.
     */
    public CompletableFuture<JsonObject> punish(String type, String target, String reason, Long durationSeconds, Actor issuer) {
        JsonObject body = new JsonObject();
        body.addProperty("type", type);
        body.addProperty("target", target);
        body.addProperty("reason", reason);
        if (durationSeconds != null) body.addProperty("durationSeconds", durationSeconds);
        body.add("issuer", issuer.toJson());
        body.addProperty("idempotencyKey", UUID.randomUUID().toString());
        return client.post("/api/plugin/v1/punishments", body);
    }

    /** Revokes the target's active ban ({@code BAN}) or mute ({@code MUTE}). */
    public CompletableFuture<JsonObject> revoke(String kind, String target, String reason, Actor revoker) {
        JsonObject body = new JsonObject();
        body.addProperty("kind", kind);
        body.addProperty("target", target);
        if (reason != null && !reason.isBlank()) body.addProperty("reason", reason);
        body.add("revoker", revoker.toJson());
        return client.post("/api/plugin/v1/punishments/revoke", body);
    }

    public CompletableFuture<JsonObject> lookup(String target, int limit) {
        return client.get("/api/plugin/v1/players/lookup?target=" + URLEncoder.encode(target, StandardCharsets.UTF_8) + "&limit=" + limit);
    }
}
