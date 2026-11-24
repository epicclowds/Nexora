package dev.mnm.plugin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Round-trips against an in-process HTTP server that verifies signatures like the backend does. */
class BackendClientTest {
    private static final String SECRET = "mnm_sk_client-test";
    private HttpServer server;
    private BackendClient client;
    private final AtomicReference<String> lastSignatureCheck = new AtomicReference<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        RequestSigner verifier = new RequestSigner("unused", SECRET);
        server.createContext("/api/plugin/v1/heartbeat", exchange -> {
            // Like the dashboard (Node.js): requests asking for a protocol upgrade (h2c) get no response.
            if (exchange.getRequestHeaders().containsKey("Upgrade")) {
                exchange.close();
                return;
            }
            byte[] body = exchange.getRequestBody().readAllBytes();
            var h = exchange.getRequestHeaders();
            String expected = verifier.signature(exchange.getRequestMethod(), exchange.getRequestURI().getRawPath(), h.getFirst(RequestSigner.HEADER_TIMESTAMP), h.getFirst(RequestSigner.HEADER_NONCE), body);
            boolean valid = expected.equals(h.getFirst(RequestSigner.HEADER_SIGNATURE)) && "mnm_key_test".equals(h.getFirst(RequestSigner.HEADER_KEY_ID));
            lastSignatureCheck.set(valid ? "valid" : "invalid");
            respond(exchange, valid ? 200 : 401, valid ? "{\"heartbeatIntervalSeconds\":15}" : "{\"code\":\"PLUGIN_AUTH_BAD_SIGNATURE\",\"message\":\"Plugin authentication failed\"}");
        });
        server.createContext("/api/plugin/v1/events", exchange -> respond(exchange, 400, "{\"code\":\"VALIDATION_FAILED\",\"message\":\"bad\"}"));
        server.start();
        URI base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        // The production client configuration, so protocol regressions fail here.
        client = new BackendClient(base, "test", new Gson(), BackendClient.newHttpClient(ForkJoinPool.commonPool()), System::currentTimeMillis);
        client.useCredentials(new Credentials("mnm_key_test", SECRET, "id", "lobby"));
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @Test
    void signsRequestsThatTheServerCanVerify() throws Exception {
        JsonObject response = client.post("/api/plugin/v1/heartbeat", Map.of("onlinePlayers", 2)).get();
        assertEquals("valid", lastSignatureCheck.get());
        assertEquals(15, response.get("heartbeatIntervalSeconds").getAsInt());
    }

    @Test
    void mapsErrorResponsesToBackendExceptions() {
        ExecutionException e = assertThrows(ExecutionException.class, () -> client.post("/api/plugin/v1/events", Map.of()).get());
        BackendException be = assertInstanceOf(BackendException.class, e.getCause());
        assertEquals(400, be.status());
        assertEquals("VALIDATION_FAILED", be.code());
    }

    @Test
    void reportsTransportErrors() {
        server.stop(0);
        ExecutionException e = assertThrows(ExecutionException.class, () -> client.get("/api/plugin/v1/ping").get());
        assertEquals(0, assertInstanceOf(BackendException.class, e.getCause()).status());
    }
}
