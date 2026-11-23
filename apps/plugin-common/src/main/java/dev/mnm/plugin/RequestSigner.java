package dev.mnm.plugin;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Signs backend requests. Must stay byte-compatible with
 * {@code apps/backend/src/plugin-api/plugin-signature.ts}:
 *
 * <pre>
 * signingKey = SHA-256(secret)
 * canonical  = METHOD \n PATH \n TIMESTAMP \n NONCE \n hex(SHA-256(body))
 * signature  = hex(HMAC-SHA256(signingKey, canonical))
 * </pre>
 *
 * The secret never leaves the server; every request carries a fresh nonce.
 */
public final class RequestSigner {
    public static final String HEADER_KEY_ID = "X-MNM-Key-Id";
    public static final String HEADER_TIMESTAMP = "X-MNM-Timestamp";
    public static final String HEADER_NONCE = "X-MNM-Nonce";
    public static final String HEADER_SIGNATURE = "X-MNM-Signature";

    private static final HexFormat HEX = HexFormat.of();
    private static final SecureRandom RANDOM = new SecureRandom();

    private final String keyId;
    private final byte[] signingKey;

    public RequestSigner(String keyId, String secret) {
        this.keyId = keyId;
        this.signingKey = sha256(secret.getBytes(StandardCharsets.UTF_8));
    }

    /** Headers for one request. A new nonce is generated on every call. */
    public Map<String, String> headers(String method, String path, byte[] body, long timestampMillis) {
        String timestamp = Long.toString(timestampMillis);
        String nonce = newNonce();
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put(HEADER_KEY_ID, keyId);
        headers.put(HEADER_TIMESTAMP, timestamp);
        headers.put(HEADER_NONCE, nonce);
        headers.put(HEADER_SIGNATURE, signature(method, path, timestamp, nonce, body));
        return headers;
    }

    public String signature(String method, String path, String timestamp, String nonce, byte[] body) {
        return hmacHex(signingKey, canonical(method, path, timestamp, nonce, body));
    }

    static String canonical(String method, String path, String timestamp, String nonce, byte[] body) {
        return String.join("\n", method.toUpperCase(Locale.ROOT), path, timestamp, nonce, HEX.formatHex(sha256(body)));
    }

    static String newNonce() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        return HEX.formatHex(bytes);
    }

    static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String hmacHex(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HEX.formatHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }
}
