package dev.mnm.plugin;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Optional;
import java.util.Properties;

/** Long-lived plugin credential issued by the backend at registration. */
public record Credentials(String keyId, String secret, String serverId, String serverName) {

    public static final String FILE_NAME = "credentials.properties";

    public static Optional<Credentials> load(Path dataDirectory) throws IOException {
        Path file = dataDirectory.resolve(FILE_NAME);
        if (!Files.exists(file)) return Optional.empty();
        Properties p = new Properties();
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            p.load(reader);
        }
        String keyId = p.getProperty("key-id", "").trim();
        String secret = p.getProperty("secret", "").trim();
        if (keyId.isEmpty() || secret.isEmpty()) return Optional.empty();
        return Optional.of(new Credentials(keyId, secret, p.getProperty("server-id", ""), p.getProperty("server-name", "")));
    }

    /** Writes atomically and restricts the file to the owner where the file system supports it. */
    public void save(Path dataDirectory) throws IOException {
        Files.createDirectories(dataDirectory);
        Path target = dataDirectory.resolve(FILE_NAME);
        Path temp = Files.createTempFile(dataDirectory, "credentials", ".tmp");
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            Files.setPosixFilePermissions(temp, PosixFilePermissions.fromString("rw-------"));
        }
        Properties p = new Properties();
        p.setProperty("key-id", keyId);
        p.setProperty("secret", secret);
        p.setProperty("server-id", serverId);
        p.setProperty("server-name", serverName);
        try (Writer writer = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            p.store(writer, "Network Manager backend credentials - keep secret, do not share");
        }
        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    @Override
    public String toString() {
        return "Credentials[keyId=" + keyId + ", serverName=" + serverName + "]";
    }
}
