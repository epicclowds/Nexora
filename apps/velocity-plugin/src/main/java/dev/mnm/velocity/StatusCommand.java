package dev.mnm.velocity;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.StatusLines;
import dev.mnm.plugin.UpdateNotifier;
import dev.mnm.plugin.punish.Durations;
import dev.mnm.plugin.punish.ReasonCatalog;
import java.time.Instant;
import java.util.List;
import java.util.Locale;

/**
 * {@code /networkmanager} (aliases {@code /nm}, {@code /nexora}): backend
 * connection status ({@code networkmanager.admin}). {@code /nexora update} or
 * {@code /nexora version} shows the update information
 * ({@code networkmanager.update.check}) – informational only, from the
 * backend's cached release check.
 */
final class StatusCommand implements SimpleCommand {
    static final String PERMISSION = "networkmanager.admin";
    private static final List<String> UPDATE_ARGS = List.of("update", "version");
    private static final List<String> SUBCOMMANDS = List.of("update", "version", "reasons");
    private static final List<String> CATEGORIES = List.of("BAN", "MUTE", "KICK", "WARN");

    private final BackendConnector connector;
    private final Messages messages;
    private final String type;
    private final UpdateNotifier updates;
    private final ReasonCatalog reasons;

    StatusCommand(BackendConnector connector, Messages messages, String type, UpdateNotifier updates, ReasonCatalog reasons) {
        this.connector = connector;
        this.messages = messages;
        this.type = type;
        this.updates = updates;
        this.reasons = reasons;
    }

    @Override
    public void execute(Invocation invocation) {
        CommandSource source = invocation.source();
        String[] args = invocation.arguments();
        if (args.length > 0 && UPDATE_ARGS.contains(args[0].toLowerCase(Locale.ROOT))) {
            if (!source.hasPermission(UpdateNotifier.CHECK_PERMISSION) && !source.hasPermission(PERMISSION)) {
                source.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
                return;
            }
            updates.infoLines(Instant.now()).forEach(source::sendMessage);
            return;
        }
        if (args.length > 0 && args[0].equalsIgnoreCase("reasons")) {
            if (!source.hasPermission(REASONS_PERMISSION) && !source.hasPermission(PERMISSION)) {
                source.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
                return;
            }
            listReasons(source);
            return;
        }
        if (!source.hasPermission(PERMISSION)) {
            source.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
            return;
        }
        StatusLines.render(messages, connector.status(), type).forEach(source::sendMessage);
    }

    /** /nexora reasons: the reasons the sender may use, per category (cached from the backend). */
    private void listReasons(CommandSource source) {
        if (reasons == null || reasons.mode() == null) {
            source.sendMessage(messages.prefixed("reasons.unavailable", java.util.Map.of()));
            return;
        }
        if (reasons.mode() == ReasonCatalog.Mode.FREE_TEXT) {
            source.sendMessage(messages.prefixed("reasons.free-text-mode", java.util.Map.of()));
            return;
        }
        source.sendMessage(messages.prefixed("reasons.title", java.util.Map.of("mode", messages.raw("reasons.mode." + reasons.mode().name().toLowerCase(Locale.ROOT)))));
        boolean any = false;
        for (String category : CATEGORIES) {
            List<ReasonCatalog.Preset> usable = reasons.usable(category, source::hasPermission);
            if (usable.isEmpty()) continue;
            any = true;
            source.sendMessage(messages.render("reasons.category." + category.toLowerCase(Locale.ROOT), java.util.Map.of()));
            for (ReasonCatalog.Preset p : usable) {
                String duration = !category.equals("BAN") && !category.equals("MUTE") ? ""
                        : p.permanent() || p.durationSeconds() == null ? messages.raw("reasons.permanent")
                        : Durations.format(java.time.Duration.ofSeconds(p.durationSeconds()));
                source.sendMessage(messages.render(duration.isEmpty() ? "reasons.entry-no-duration" : "reasons.entry", java.util.Map.of(
                        "id", String.valueOf(p.numericId()), "name", p.name(), "duration", duration)));
            }
        }
        if (!any) source.sendMessage(messages.render("reasons.none", java.util.Map.of()));
    }

    @Override
    public List<String> suggest(Invocation invocation) {
        String[] args = invocation.arguments();
        if (args.length > 1) return List.of();
        String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
        return SUBCOMMANDS.stream().filter(a -> a.startsWith(prefix)).toList();
    }

    /** Visible to staff with any of the subcommand permissions; each subcommand checks its own. */
    @Override
    public boolean hasPermission(Invocation invocation) {
        CommandSource source = invocation.source();
        return source.hasPermission(PERMISSION) || source.hasPermission(UpdateNotifier.CHECK_PERMISSION) || source.hasPermission(REASONS_PERMISSION);
    }

    /** Listing reasons (it only shows reasons the sender may use anyway). */
    static final String REASONS_PERMISSION = "nexora.command.reasons";
}
