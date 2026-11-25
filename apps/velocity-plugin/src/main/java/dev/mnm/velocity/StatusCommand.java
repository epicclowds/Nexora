package dev.mnm.velocity;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.StatusLines;
import dev.mnm.plugin.UpdateNotifier;
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

    private final BackendConnector connector;
    private final Messages messages;
    private final String type;
    private final UpdateNotifier updates;

    StatusCommand(BackendConnector connector, Messages messages, String type, UpdateNotifier updates) {
        this.connector = connector;
        this.messages = messages;
        this.type = type;
        this.updates = updates;
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
        if (!source.hasPermission(PERMISSION)) {
            source.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
            return;
        }
        StatusLines.render(messages, connector.status(), type).forEach(source::sendMessage);
    }

    @Override
    public List<String> suggest(Invocation invocation) {
        String[] args = invocation.arguments();
        if (args.length > 1) return List.of();
        String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
        return UPDATE_ARGS.stream().filter(a -> a.startsWith(prefix)).toList();
    }

    @Override
    public boolean hasPermission(Invocation invocation) {
        return invocation.source().hasPermission(PERMISSION) || invocation.source().hasPermission(UpdateNotifier.CHECK_PERMISSION);
    }
}
