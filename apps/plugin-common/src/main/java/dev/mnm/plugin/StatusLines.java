package dev.mnm.plugin;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.kyori.adventure.text.Component;

/** Lines for the in-game {@code /networkmanager} status command. */
public final class StatusLines {
    private StatusLines() {}

    public static List<Component> render(Messages messages, BackendConnector.Status status, String type) {
        List<Component> lines = new ArrayList<>();
        lines.add(messages.prefixed("status.title", Map.of()));
        if (!status.registered()) {
            lines.add(messages.render("status.unregistered", Map.of()));
            return lines;
        }
        lines.add(messages.render("status.server", Map.of("server", String.valueOf(status.serverName()), "type", type)));
        if (status.connected()) {
            lines.add(messages.render("status.connected", Map.of("time", ago(status.lastSuccess()))));
        } else {
            lines.add(messages.render("status.disconnected", Map.of("error", status.lastError() == null ? "-" : status.lastError())));
        }
        lines.add(messages.render("status.queue", Map.of("pending", String.valueOf(status.pendingEvents()), "dropped", String.valueOf(status.droppedEvents()))));
        return lines;
    }

    private static String ago(Instant instant) {
        if (instant == null) return "-";
        long seconds = Math.max(0, Duration.between(instant, Instant.now()).toSeconds());
        return seconds + "s";
    }
}
