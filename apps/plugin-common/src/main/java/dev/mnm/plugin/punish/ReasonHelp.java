package dev.mnm.plugin.punish;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * The reason list shown by {@code /ban} and {@code /mute} without a reason and by
 * {@code /nexora reasons <category> [page]}: command usage plus the reason
 * presets the sender may use, paginated, following the global command mode.
 *
 * <p>Only presets the sender holds the permission for are listed (checked
 * through the platform's permission API – LuckPerms when installed), so
 * restricted reasons are never revealed. The list is informational: the
 * punishment command re-checks the permission, and the backend decides.
 *
 * <p>Platform independent: returns message keys and variables, which the
 * plugin renders with its {@code Messages}.
 */
public final class ReasonHelp {
    /** Reasons per chat page – enough to be useful without flooding the chat. */
    public static final int PAGE_SIZE = 8;

    public static final String CUSTOM_PERMISSION = "nexora.punishment.custom";
    public static final String DURATION_OVERRIDE_PERMISSION = "nexora.punishment.duration-override";

    /** One chat line: a message key, its variables and whether it carries the [Nexora] prefix. */
    public record Line(String key, Map<String, String> vars, boolean prefixed) {
        static Line of(String key, Map<String, String> vars) {
            return new Line(key, vars, false);
        }

        static Line prefixed(String key, Map<String, String> vars) {
            return new Line(key, vars, true);
        }
    }

    /** A page of a list (1-based; out-of-range pages are clamped). */
    public record Page<T>(List<T> items, int page, int pages, int total) {
        public boolean hasNext() {
            return page < pages;
        }
    }

    private ReasonHelp() {}

    public static <T> Page<T> page(List<T> all, int requested, int size) {
        int pages = Math.max(1, (all.size() + size - 1) / size);
        int page = Math.min(Math.max(1, requested), pages);
        int from = (page - 1) * size;
        return new Page<>(all.subList(Math.min(from, all.size()), Math.min(from + size, all.size())), page, pages, all.size());
    }

    /**
     * Lines for a category's reason list.
     *
     * @param mode     the global command mode, or null while the catalogue is not loaded
     * @param category BAN, MUTE, KICK or WARN
     * @param command  the command as typed (alias), e.g. {@code ban}
     * @param player   the player argument if given ({@code /ban Steve}), else null
     * @param usable   the presets of this category the sender may use, in display order
     * @param page     requested page (1-based)
     * @param can      the sender's permission check
     * @param raw      resolves plain message texts (e.g. "permanent")
     */
    public static List<Line> lines(ReasonCatalog.Mode mode, String category, String command, String player, List<ReasonCatalog.Preset> usable, int page,
            Predicate<String> can, Function<String, String> raw) {
        String cat = category.toLowerCase(Locale.ROOT);
        String target = player == null || player.isBlank() ? "<player>" : player;
        String typed = "/" + command + " " + target + " <reason>";
        List<Line> lines = new ArrayList<>();

        if (mode == ReasonCatalog.Mode.FREE_TEXT) {
            // Reason IDs are not executable in this mode – usage only.
            lines.add(Line.prefixed("reasons.usage", Map.of("usage", typed)));
            return lines;
        }
        if (mode == null) {
            lines.add(Line.prefixed("reasons.usage", Map.of("usage", "/" + command + " " + target + " <reason-id|reason>")));
            lines.add(Line.of("reasons.unavailable", Map.of()));
            return lines;
        }

        boolean durations = category.equals("BAN") || category.equals("MUTE");
        String byId = "/" + command + " " + target + " <reason-id>" + (durations && can.test(DURATION_OVERRIDE_PERMISSION) ? " [duration]" : "");
        lines.add(Line.prefixed("reasons.list.title." + cat, Map.of()));
        lines.add(Line.of("reasons.usage", Map.of("usage", byId)));
        if (mode == ReasonCatalog.Mode.HYBRID && can.test(CUSTOM_PERMISSION)) {
            lines.add(Line.of("reasons.custom-hint", Map.of("usage", typed)));
        }
        if (usable.isEmpty()) {
            lines.add(Line.of("reasons.none-category", Map.of()));
            return lines;
        }
        Page<ReasonCatalog.Preset> shown = page(usable, page, PAGE_SIZE);
        for (ReasonCatalog.Preset preset : shown.items()) lines.add(entry(preset, durations, raw));
        if (shown.pages() > 1) {
            lines.add(Line.of("reasons.page", Map.of("page", String.valueOf(shown.page()), "pages", String.valueOf(shown.pages()))));
            if (shown.hasNext()) lines.add(Line.of("reasons.page-next", Map.of("command", "/nexora reasons " + cat + " " + (shown.page() + 1))));
        }
        return lines;
    }

    /** One reason: ID, name and – for bans and mutes – the duration or "permanent". */
    public static Line entry(ReasonCatalog.Preset preset, boolean withDuration, Function<String, String> raw) {
        String duration = !withDuration ? ""
                : preset.permanent() || preset.durationSeconds() == null ? raw.apply("reasons.permanent")
                : readable(preset.durationSeconds(), raw);
        return Line.of(duration.isEmpty() ? "reasons.entry-no-duration" : "reasons.entry",
                Map.of("id", String.valueOf(preset.numericId()), "name", preset.name(), "duration", duration));
    }

    /**
     * Translated, readable duration with at most the two largest units:
     * {@code 30 days}, {@code 12 hours}, {@code 1 day 12 hours}.
     */
    public static String readable(long seconds, Function<String, String> raw) {
        long[] amounts = {seconds / 86_400, seconds % 86_400 / 3600, seconds % 3600 / 60};
        String[] units = {"day", "hour", "minute"};
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < amounts.length && parts.size() < 2; i++) {
            if (amounts[i] == 0) {
                if (!parts.isEmpty()) break;
                continue;
            }
            String key = "reasons.unit." + units[i] + (amounts[i] == 1 ? "" : "s");
            parts.add(raw.apply(key).replace("{n}", String.valueOf(amounts[i])));
        }
        if (parts.isEmpty()) return Durations.format(Duration.ofSeconds(seconds));
        return String.join(" ", parts);
    }

    /** "ban", "mutes", "WARNING" … → BAN/MUTE/KICK/WARN, or null. */
    public static String parseCategory(String input) {
        if (input == null) return null;
        String value = input.toLowerCase(Locale.ROOT);
        if (value.endsWith("s")) value = value.substring(0, value.length() - 1);
        return switch (value) {
            case "ban" -> "BAN";
            case "mute" -> "MUTE";
            case "kick" -> "KICK";
            case "warn", "warning" -> "WARN";
            default -> null;
        };
    }
}
