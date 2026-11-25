package dev.mnm.plugin.punish;

import java.time.Duration;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/**
 * Splits the arguments after the player name of /ban, /mute, /kick and /warn
 * into a reason ID (with an optional duration override) or a typed reason.
 *
 * <p>Same rule as the backend: in preset and hybrid mode, exactly one number
 * ({@code /ban Steve 1}) – optionally followed by a duration or
 * {@code permanent} ({@code /ban Steve 1 7d}) – is a reason ID; everything
 * else is a typed reason ({@code /ban Steve 1 day of griefing}). In free-text
 * mode numbers are ordinary text.
 */
public record ReasonArguments(Integer reasonId, boolean override, Long overrideSeconds, String reason) {
    /** Override value meaning "permanent" ({@code overrideSeconds == null && override}). */
    public boolean permanentOverride() {
        return override && overrideSeconds == null;
    }

    public boolean isPreset() {
        return reasonId != null;
    }

    public static ReasonArguments parse(String[] rest, boolean presetsAllowed) {
        if (presetsAllowed && (rest.length == 1 || rest.length == 2)) {
            Integer id = reference(rest[0]);
            if (id != null) {
                if (rest.length == 1) return new ReasonArguments(id, false, null, null);
                String token = rest[1].toLowerCase(Locale.ROOT);
                if (token.equals("permanent") || token.equals("perm")) return new ReasonArguments(id, true, null, null);
                Optional<Duration> duration = Durations.parse(token);
                if (duration.isPresent()) return new ReasonArguments(id, true, duration.get().toSeconds(), null);
            }
        }
        return new ReasonArguments(null, false, null, String.join(" ", Arrays.asList(rest)).trim());
    }

    /** A reason ID token: one to four digits (identical to the backend's rule). */
    public static Integer reference(String token) {
        return token != null && token.matches("\\d{1,4}") ? Integer.valueOf(token) : null;
    }
}
