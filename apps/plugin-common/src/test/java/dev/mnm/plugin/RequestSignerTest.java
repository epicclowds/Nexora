package dev.mnm.plugin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RequestSignerTest {
    // Shared test vector - identical values are asserted in apps/backend/test/plugin.spec.ts.
    private static final String SECRET = "mnm_sk_test-vector-secret";
    private static final String SIGNING_KEY_HEX = "2d82f41db33f1785036be6980f75ca56279ad6c7a3a2de9dad2374e2d1ea85ca"; // gitleaks:allow (test vector)
    private static final String EXPECTED = "abbe9d82b6527986e5434b4df02b8ff6d6ce279d6cffebd9a722221ac561bb03";
    private static final byte[] BODY = "{\"onlinePlayers\":3}".getBytes(StandardCharsets.UTF_8);

    @Test
    void signingKeyIsSha256OfSecret() {
        assertEquals(SIGNING_KEY_HEX, HexFormat.of().formatHex(RequestSigner.sha256(SECRET.getBytes(StandardCharsets.UTF_8))));
    }

    @Test
    void matchesBackendTestVector() {
        RequestSigner signer = new RequestSigner("key", SECRET);
        assertEquals(EXPECTED, signer.signature("POST", "/api/plugin/v1/heartbeat", "1795400000000", "nonce-0123456789abcdef", BODY));
    }

    @Test
    void methodIsCaseInsensitive() {
        RequestSigner signer = new RequestSigner("key", SECRET);
        assertEquals(EXPECTED, signer.signature("post", "/api/plugin/v1/heartbeat", "1795400000000", "nonce-0123456789abcdef", BODY));
    }

    @Test
    void headersUseFreshNonces() {
        RequestSigner signer = new RequestSigner("mnm_key_abc", SECRET);
        Map<String, String> a = signer.headers("GET", "/api/plugin/v1/ping", new byte[0], 1L);
        Map<String, String> b = signer.headers("GET", "/api/plugin/v1/ping", new byte[0], 1L);
        assertEquals("mnm_key_abc", a.get(RequestSigner.HEADER_KEY_ID));
        assertNotEquals(a.get(RequestSigner.HEADER_NONCE), b.get(RequestSigner.HEADER_NONCE));
        assertNotEquals(a.get(RequestSigner.HEADER_SIGNATURE), b.get(RequestSigner.HEADER_SIGNATURE));
        assertTrue(a.get(RequestSigner.HEADER_NONCE).matches("[0-9a-f]{32}"));
    }
}
