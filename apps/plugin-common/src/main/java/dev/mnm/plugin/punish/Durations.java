package dev.mnm.plugin.punish;

import java.time.Duration;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Command durations such as {@code 30m}, {@code 12h}, {@code 7d}, {@code 2w},
 * {@code 1mo}, {@code 1y} and combinations like {@code 1d12h}.
 * Months count as 30 days and years as 365 days.
 */
public final class Durations {
    private static final Pattern PART = Pattern.compile("(\\d{1,6})(mo|[smhdwy])");
    public static final Duration MIN = Duration.ofMinutes(1);
    public static final Duration MAX = Duration.ofDays(3650);

    private Durations() {}

    public static Optional<Duration> parse(String input) {
        String value = input.toLowerCase(Locale.ROOT).trim();
        if (value.isEmpty()) return Optional.empty();
        Matcher m = PART.matcher(value);
        Duration total = Duration.ZERO;
        int end = 0;
        while (m.find()) {
            if (m.start() != end) return Optional.empty();
            long n = Long.parseLong(m.group(1));
            total = total.plus(switch (m.group(2)) {
                case "s" -> Duration.ofSeconds(n);
                case "m" -> Duration.ofMinutes(n);
                case "h" -> Duration.ofHours(n);
                case "d" -> Duration.ofDays(n);
                case "w" -> Duration.ofDays(n * 7);
                case "mo" -> Duration.ofDays(n * 30);
                case "y" -> Duration.ofDays(n * 365);
                default -> throw new IllegalStateException();
            });
            end = m.end();
        }
        if (end != value.length() || total.compareTo(MIN) < 0 || total.compareTo(MAX) > 0) return Optional.empty();
        return Optional.of(total);
    }

    /** Compact, language-neutral rendering, e.g. {@code 7d 12h}. */
    public static String format(Duration duration) {
        long seconds = Math.max(0, duration.toSeconds());
        long days = seconds / 86_400;
        long hours = seconds % 86_400 / 3600;
        long minutes = seconds % 3600 / 60;
        StringBuilder sb = new StringBuilder();
        if (days > 0) sb.append(days).append("d ");
        if (hours > 0) sb.append(hours).append("h ");
        if (minutes > 0 || sb.isEmpty()) sb.append(minutes).append("m");
        return sb.toString().trim();
    }
}
