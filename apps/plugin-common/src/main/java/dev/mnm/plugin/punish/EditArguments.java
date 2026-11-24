package dev.mnm.plugin.punish;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Arguments of {@code /editban} and {@code /editmute}:
 * {@code <player|#id> <duration|permanent|keep> [reason]}.
 *
 * <ul>
 *   <li>{@code <duration>} is the new <b>total</b> duration counted from the time the
 *       punishment was created (e.g. a ban from Monday edited to {@code 7d} ends next Monday).</li>
 *   <li>{@code permanent} makes it permanent; {@code keep} leaves the duration unchanged
 *       (reason-only edit, a reason is then required).</li>
 *   <li>{@code #<id>} edits a specific punishment instead of the player's active one.</li>
 * </ul>
 */
public record EditArguments(String target, String id, ModerationClient.EditDuration duration, String reason) {
    public static final List<String> DURATION_SUGGESTIONS = List.of("30m", "12h", "7d", "30d", "permanent", "keep");

    /** Parse result: either arguments or the message key of the problem. */
    public record Result(EditArguments arguments, String errorKey, String input) {
        static Result ok(EditArguments a) {
            return new Result(a, null, null);
        }

        static Result error(String key, String input) {
            return new Result(null, key, input);
        }
    }

    public static Result parse(String[] args) {
        if (args.length < 2) return Result.error("error.usage", "");
        String target = args[0];
        String id = null;
        if (target.startsWith("#")) {
            id = target.substring(1);
            if (!id.matches("[a-z0-9]{8,32}")) return Result.error("error.punishment-not-found", target);
            target = null;
        }
        String reason = String.join(" ", Arrays.copyOfRange(args, 2, args.length)).trim();
        String mode = args[1].toLowerCase(Locale.ROOT);
        ModerationClient.EditDuration duration;
        switch (mode) {
            case "permanent", "perm" -> duration = ModerationClient.EditDuration.permanent();
            case "keep", "-" -> {
                if (reason.isEmpty()) return Result.error("error.usage", "");
                duration = null;
            }
            default -> {
                Optional<Duration> parsed = Durations.parse(mode);
                if (parsed.isEmpty()) return Result.error("error.invalid-duration", args[1]);
                duration = new ModerationClient.EditDuration(parsed.get().toSeconds());
            }
        }
        return Result.ok(new EditArguments(target, id, duration, reason.isEmpty() ? null : reason));
    }
}
