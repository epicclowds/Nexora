package dev.mnm.velocity;

import com.velocitypowered.api.command.SimpleCommand;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.StatusLines;

/** {@code /networkmanager} (alias {@code /nm}): shows the backend connection status. */
final class StatusCommand implements SimpleCommand {
    static final String PERMISSION = "networkmanager.admin";

    private final BackendConnector connector;
    private final Messages messages;
    private final String type;

    StatusCommand(BackendConnector connector, Messages messages, String type) {
        this.connector = connector;
        this.messages = messages;
        this.type = type;
    }

    @Override
    public void execute(Invocation invocation) {
        StatusLines.render(messages, connector.status(), type).forEach(invocation.source()::sendMessage);
    }

    @Override
    public boolean hasPermission(Invocation invocation) {
        return invocation.source().hasPermission(PERMISSION);
    }
}
