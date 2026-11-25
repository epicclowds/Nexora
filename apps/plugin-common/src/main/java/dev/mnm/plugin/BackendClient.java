package dev.mnm.plugin;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.function.LongSupplier;

/** Asynchronous JSON client for the backend API. Never blocks Minecraft threads. */
public final class BackendClient {
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final URI baseUrl;
    private final String userAgent;
    private final Gson gson;
    private final HttpClient http;
    private final LongSupplier clock;
    private volatile RequestSigner signer;

    public BackendClient(URI baseUrl, String userAgent, Gson gson, Executor executor) {
        this(baseUrl, userAgent, gson, newHttpClient(executor), System::currentTimeMillis);
    }

    /**
     * HTTP client used for the backend. Pinned to HTTP/1.1: with the default
     * (HTTP/2) the JDK sends an {@code Upgrade: h2c} request on plain-HTTP
     * URLs, which the dashboard's Node.js server closes without a response
     * ("header parser received no bytes") – plugins could not register with a
     * dashboard reached over http://. HTTPS works with HTTP/1.1 as well.
     */
    static HttpClient newHttpClient(Executor executor) {
        return HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .executor(executor)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    BackendClient(URI baseUrl, String userAgent, Gson gson, HttpClient http, LongSupplier clock) {
        this.baseUrl = baseUrl;
        this.userAgent = userAgent;
        this.gson = gson;
        this.http = http;
        this.clock = clock;
    }

    public void useCredentials(Credentials credentials) {
        this.signer = new RequestSigner(credentials.keyId(), credentials.secret());
    }

    public boolean hasCredentials() {
        return signer != null;
    }

    /** Unsigned call (registration only). */
    public CompletableFuture<JsonObject> postUnsigned(String path, Object body) {
        return send("POST", path, body, false);
    }

    public CompletableFuture<JsonObject> get(String path) {
        return send("GET", path, null, true);
    }

    public CompletableFuture<JsonObject> post(String path, Object body) {
        return send("POST", path, body, true);
    }

    private CompletableFuture<JsonObject> send(String method, String path, Object body, boolean signed) {
        byte[] payload = body == null ? new byte[0] : gson.toJson(body).getBytes(StandardCharsets.UTF_8);
        HttpRequest.Builder builder = HttpRequest.newBuilder(baseUrl.resolve(path))
                .timeout(TIMEOUT)
                .header("User-Agent", userAgent)
                .header("Accept", "application/json")
                .method(method, payload.length == 0 ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(payload));
        if (payload.length > 0) builder.header("Content-Type", "application/json");
        if (signed) {
            RequestSigner current = signer;
            if (current == null) return CompletableFuture.failedFuture(new BackendException(401, "NOT_REGISTERED", "Plugin is not registered"));
            current.headers(method, path, payload, clock.getAsLong()).forEach(builder::header);
        }

        return http.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
                .handle((response, error) -> {
                    if (error != null) {
                        Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
                        throw new BackendException("Backend unreachable: " + cause.getClass().getSimpleName() + (cause.getMessage() == null ? "" : " " + cause.getMessage()), cause);
                    }
                    JsonObject json = parse(response.body());
                    if (response.statusCode() / 100 != 2) {
                        String code = json.has("code") ? json.get("code").getAsString() : "HTTP_" + response.statusCode();
                        String message = json.has("message") ? json.get("message").getAsString() : "HTTP " + response.statusCode();
                        java.util.Map<String, String> details = new java.util.HashMap<>();
                        for (var entry : json.entrySet()) {
                            if (entry.getValue().isJsonPrimitive() && !entry.getKey().equals("message")) details.put(entry.getKey(), entry.getValue().getAsString());
                        }
                        throw new BackendException(response.statusCode(), code, message, details);
                    }
                    return json;
                });
    }

    private static JsonObject parse(String body) {
        if (body == null || body.isBlank()) return new JsonObject();
        try {
            JsonElement element = JsonParser.parseString(body);
            return element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
        } catch (JsonParseException e) {
            return new JsonObject();
        }
    }
}
