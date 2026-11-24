package dev.mnm.plugin.punish;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpServer;
import dev.mnm.plugin.BackendClient;
import dev.mnm.plugin.Credentials;
import dev.mnm.plugin.Messages;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;

/** /editban argument parsing, edited ban screens and feed handling of edits. */
class PunishmentEditingTest {
    private static final UUID STEVE = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");

    @Test
    void parsesEditArguments() {
        EditArguments.Result days = EditArguments.parse(new String[] {"Steve", "30d", "Repeated", "cheating"});
        assertEquals("Steve", days.arguments().target());
        assertEquals(30L * 86_400, days.arguments().duration().seconds());
        assertEquals("Repeated cheating", days.arguments().reason());

        EditArguments.Result permanent = EditArguments.parse(new String[] {"#clx0abcd1234", "permanent"});
        assertEquals("clx0abcd1234", permanent.arguments().id());
        assertNull(permanent.arguments().target());
        assertTrue(permanent.arguments().duration().isPermanent());
        assertNull(permanent.arguments().reason());

        EditArguments.Result keep = EditArguments.parse(new String[] {"Steve", "keep", "Using", "an", "auto-clicker"});
        assertNull(keep.arguments().duration(), "keep = reason-only edit");
        assertEquals("Using an auto-clicker", keep.arguments().reason());
    }

    @Test
    void rejectsAmbiguousOrInvalidArguments() {
        assertEquals("error.usage", EditArguments.parse(new String[] {"Steve"}).errorKey());
        assertEquals("error.usage", EditArguments.parse(new String[] {"Steve", "keep"}).errorKey(), "keep without a reason changes nothing");
        assertEquals("error.invalid-duration", EditArguments.parse(new String[] {"Steve", "30x"}).errorKey());
        assertEquals("error.invalid-duration", EditArguments.parse(new String[] {"Steve", "0m"}).errorKey());
        assertEquals("error.punishment-not-found", EditArguments.parse(new String[] {"#bad id!", "7d"}).errorKey());
    }

    @Test
    void banScreenShowsCurrentValuesRemainingTimeAndAppeal() throws Exception {
        Messages messages = Messages.load(getClass().getClassLoader(), "en-US");
        long now = 1_800_000_000_000L;
        CachedPunishment ban = new CachedPunishment("clx0ban", "TEMP_BAN", STEVE, "Steve", null, "Repeated cheating", "Admin", now - 86_400_000L, now + 3L * 86_400_000L + 3_600_000L);
        String plain = PlainTextComponentSerializer.plainText().serialize(new PunishmentTexts(messages, () -> "https://example.com/appeal").banScreen(ban, now));
        assertTrue(plain.contains("Reason: Repeated cheating"), plain);
        assertTrue(plain.contains("3d 1h remaining"), plain);
        assertTrue(plain.contains("Punishment ID: clx0ban"), plain);
        assertTrue(plain.contains("Appeal: https://example.com/appeal"), plain);
        String withoutAppeal = PlainTextComponentSerializer.plainText().serialize(new PunishmentTexts(messages).banScreen(ban, now));
        assertFalse(withoutAppeal.contains("Appeal"), withoutAppeal);
    }

    @Test
    void feedAppliesEditsAndNeverCachesInactivePunishments(@TempDir Path dir) throws Exception {
        long now = System.currentTimeMillis();
        JsonObject edited = punishment("p1", "TEMP_BAN", "Repeated cheating", now + 86_400_000L, "ACTIVE");
        JsonObject revokedCorrection = punishment("p2", "BAN", "Corrected", null, "REVOKED");
        JsonObject reactivated = punishment("p3", "MUTE", "Spam", null, "ACTIVE");
        JsonObject changes = new JsonObject();
        JsonArray list = new JsonArray();
        list.add(change("1", "UPDATED", now, edited));
        list.add(change("2", "UPDATED", now, revokedCorrection));
        list.add(change("3", "REACTIVATED", now, reactivated));
        changes.add("changes", list);
        changes.addProperty("cursor", "3");
        changes.addProperty("hasMore", false);
        JsonObject snapshot = new JsonObject();
        JsonArray active = new JsonArray();
        active.add(punishment("p1", "TEMP_BAN", "Cheating", now + 3_600_000L, "ACTIVE"));
        active.add(punishment("p2", "BAN", "Stale", null, "ACTIVE"));
        snapshot.add("punishments", active);
        snapshot.addProperty("cursor", "0");

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/plugin/v1/punishments/active", ex -> respond(ex, snapshot));
        server.createContext("/api/plugin/v1/punishments/changes", ex -> respond(ex, changes));
        server.start();
        try {
            BackendClient client = new BackendClient(URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "test", new Gson(), ForkJoinPool.commonPool());
            client.useCredentials(new Credentials("mnm_key_test", "secret", "server", "lobby"));
            PunishmentCache cache = new PunishmentCache();
            List<String> events = new ArrayList<>();
            PunishmentFeed feed = new PunishmentFeed(client, cache, dir, new PunishmentFeed.Listener() {
                @Override
                public void created(CachedPunishment p) {
                    events.add("created:" + p.id());
                }

                @Override
                public void updated(CachedPunishment p) {
                    events.add("updated:" + p.id());
                }

                @Override
                public void reactivated(CachedPunishment p) {
                    events.add("reactivated:" + p.id());
                }
            }, LoggerFactory.getLogger("test"));

            feed.poll().get(10, TimeUnit.SECONDS); // snapshot
            feed.poll().get(10, TimeUnit.SECONDS); // changes
            assertEquals("Repeated cheating", cache.findBan(STEVE, null, now).orElseThrow().reason(), "edited reason replaces the cached one");
            assertEquals(now + 86_400_000L, cache.findBan(STEVE, null, now).orElseThrow().expiresAt());
            assertTrue(cache.findMute(STEVE, now).isPresent(), "reactivated mute is enforced again");
            assertEquals(2, cache.size(), "inactive p2 must not be cached even though the entry is an update");
            assertEquals(List.of("updated:p1", "reactivated:p3"), events);
        } finally {
            server.stop(0);
        }
    }

    private static JsonObject punishment(String id, String type, String reason, Long expiresAt, String status) {
        JsonObject o = new JsonObject();
        o.addProperty("id", id);
        o.addProperty("type", type);
        o.addProperty("targetUuid", STEVE.toString());
        o.addProperty("targetName", "Steve");
        o.addProperty("reason", reason);
        o.addProperty("issuerName", "Admin");
        o.addProperty("status", status);
        o.addProperty("createdAt", System.currentTimeMillis() - 60_000L);
        o.addProperty("expiresAt", expiresAt);
        return o;
    }

    private static JsonObject change(String id, String kind, long at, JsonObject punishment) {
        JsonObject c = new JsonObject();
        c.addProperty("id", id);
        c.addProperty("kind", kind);
        c.addProperty("at", at);
        c.add("punishment", punishment);
        return c;
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, JsonObject body) throws java.io.IOException {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
