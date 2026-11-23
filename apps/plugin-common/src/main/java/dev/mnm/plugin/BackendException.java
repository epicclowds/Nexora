package dev.mnm.plugin;

/** Error returned by the backend API (non-2xx) or a transport failure (status 0). */
public final class BackendException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final int status;
    private final String code;

    public BackendException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public BackendException(String message, Throwable cause) {
        super(message, cause);
        this.status = 0;
        this.code = "TRANSPORT_ERROR";
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
