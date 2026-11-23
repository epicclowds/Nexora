package dev.mnm.paper.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * A violation reported by an AntiCheat integration.
 *
 * @param player the offending player
 * @param cheatType check name, matched case-insensitively against the network's rules (e.g. "Speed")
 * @param violationLevel the integration's violation level, used for rule thresholds (optional)
 * @param reason punishment reason shown to the player (optional; defaults to "[AntiCheat] cheatType")
 * @param evidence free-text evidence stored with the punishment (optional)
 * @param metadata additional key/value details (strings, numbers, booleans)
 */
public record AntiCheatReport(UUID player, String cheatType, Double violationLevel, String reason, String evidence, Map<String, Object> metadata) {

    public AntiCheatReport {
        Objects.requireNonNull(player, "player");
        Objects.requireNonNull(cheatType, "cheatType");
        metadata = metadata == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(metadata));
    }

    public static Builder builder(UUID player, String cheatType) {
        return new Builder(player, cheatType);
    }

    public static final class Builder {
        private final UUID player;
        private final String cheatType;
        private Double violationLevel;
        private String reason;
        private String evidence;
        private final Map<String, Object> metadata = new LinkedHashMap<>();

        private Builder(UUID player, String cheatType) {
            this.player = player;
            this.cheatType = cheatType;
        }

        public Builder violationLevel(double level) {
            this.violationLevel = level;
            return this;
        }

        public Builder reason(String reason) {
            this.reason = reason;
            return this;
        }

        public Builder evidence(String evidence) {
            this.evidence = evidence;
            return this;
        }

        /** Adds a metadata entry. Supported values: String, Number, Boolean. */
        public Builder metadata(String key, Object value) {
            if (value instanceof String || value instanceof Number || value instanceof Boolean) metadata.put(key, value);
            else throw new IllegalArgumentException("Unsupported metadata value type: " + (value == null ? "null" : value.getClass().getName()));
            return this;
        }

        public AntiCheatReport build() {
            return new AntiCheatReport(player, cheatType, violationLevel, reason, evidence, metadata);
        }
    }
}
