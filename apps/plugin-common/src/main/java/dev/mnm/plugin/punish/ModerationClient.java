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
        return punish(type, target, reason, durationSeconds, issuer, java.util.List.of());
    }

    /** Typed reason; {@code granted}: canonical permissions verified in-game (e.g. nexora.punishment.custom). */
    public CompletableFuture<JsonObject> punish(String type, String target, String reason, Long durationSeconds, Actor issuer, java.util.Collection<String> granted) {
        JsonObject body = new JsonObject();
        body.addProperty("type", type);
        body.addProperty("target", target);
        body.addProperty("reason", reason);
        if (durationSeconds != null) body.addProperty("durationSeconds", durationSeconds);
        return send(body, issuer, granted);
    }

    /**
     * Reason ID (preset). {@code override}: null = the preset's duration, otherwise
     * an {@link EditDuration} (seconds, or permanent).
     */
    public CompletableFuture<JsonObject> punishWithPreset(String type, String target, int reasonId, EditDuration override, Actor issuer, java.util.Collection<String> granted) {
        JsonObject body = new JsonObject();
        body.addProperty("type", type);
        body.addProperty("target", target);
        body.addProperty("presetNumericId", reasonId);
        if (override != null) {
            if (override.isPermanent()) body.add("durationSeconds", com.google.gson.JsonNull.INSTANCE);
            else body.addProperty("durationSeconds", override.seconds());
        }
        return send(body, issuer, granted);
    }

    private CompletableFuture<JsonObject> send(JsonObject body, Actor issuer, java.util.Collection<String> granted) {
        body.add("issuer", issuer.toJson());
        com.google.gson.JsonArray list = new com.google.gson.JsonArray();
        granted.forEach(list::add);
        body.add("granted", list);
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
        return edit(edit, allowPermanentChange, editor, java.util.List.of());
    }

    public CompletableFuture<JsonObject> edit(Edit edit, boolean allowPermanentChange, Actor editor, java.util.Collection<String> granted) {
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
        com.google.gson.JsonArray list = new com.google.gson.JsonArray();
        granted.forEach(list::add);
        body.add("granted", list);
        return client.post("/api/plugin/v1/punishments/edit", body);
    }

    public CompletableFuture<JsonObject> lookup(String target, int limit) {
        return client.get("/api/plugin/v1/players/lookup?target=" + URLEncoder.encode(target, StandardCharsets.UTF_8) + "&limit=" + limit);
    }
}
