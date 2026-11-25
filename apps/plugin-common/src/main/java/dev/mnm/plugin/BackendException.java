package dev.mnm.plugin;

/** Error returned by the backend API (non-2xx) or a transport failure (status 0). */
public final class BackendException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final int status;
    private final String code;
    /** Additional primitive fields of the error body (e.g. reasonId); never secrets. */
    private final transient java.util.Map<String, String> details;

    public BackendException(int status, String code, String message) {
        this(status, code, message, java.util.Map.of());
    }

    public BackendException(int status, String code, String message, java.util.Map<String, String> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = java.util.Map.copyOf(details);
    }

    public BackendException(String message, Throwable cause) {
        super(message, cause);
        this.status = 0;
        this.code = "TRANSPORT_ERROR";
        this.details = java.util.Map.of();
    }

    /** A detail field of the error body, or "" when absent. */
    public String detail(String key) {
        return details.getOrDefault(key, "");
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    /** Errors that will not go away by retrying the same request. */
    public boolean isPermanent() {
        return status == 400 || status == 403 || status == 404 || status == 422;
    }

    public boolean isAuthenticationFailure() {
        return status == 401;
    }
}
