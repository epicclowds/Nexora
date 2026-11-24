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

    /** What /editban and /editmute change; a null field keeps the current value. */
    public record Edit(String kind, String target, String id, EditDuration duration, String reason) {}

    /** New total duration counted from the creation time, or permanent. */
    public record EditDuration(Long seconds) {
        public static EditDuration permanent() {
            return new EditDuration(null);
        }

        public boolean isPermanent() {
            return seconds == null;
        }
    }

    /**
     * Edits the active ban/mute of a player (or a punishment by id) in place.
     * {@code allowPermanentChange}: the editor holds the permission for
     * temporary ↔ permanent conversions (checked against the planned change).
     */
    public CompletableFuture<JsonObject> edit(Edit edit, boolean allowPermanentChange, Actor editor) {
        JsonObject body = new JsonObject();
        body.addProperty("kind", edit.kind());
        if (edit.id() != null) body.addProperty("id", edit.id());
        else body.addProperty("target", edit.target());
        if (edit.duration() != null) {
            if (edit.duration().isPermanent()) body.add("durationSeconds", com.google.gson.JsonNull.INSTANCE);
            else body.addProperty("durationSeconds", edit.duration().seconds());
        }
        if (edit.reason() != null && !edit.reason().isBlank()) body.addProperty("reason", edit.reason());
        body.add("editor", editor.toJson());
        body.addProperty("allowPermanentChange", allowPermanentChange);
        return client.post("/api/plugin/v1/punishments/edit", body);
    }

    public CompletableFuture<JsonObject> lookup(String target, int limit) {
        return client.get("/api/plugin/v1/players/lookup?target=" + URLEncoder.encode(target, StandardCharsets.UTF_8) + "&limit=" + limit);
    }
}
