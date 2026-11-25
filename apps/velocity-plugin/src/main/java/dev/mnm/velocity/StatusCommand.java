package dev.mnm.velocity;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.StatusLines;
import dev.mnm.plugin.UpdateNotifier;
import dev.mnm.plugin.punish.ReasonCatalog;
import dev.mnm.plugin.punish.ReasonHelp;
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
    private static final List<String> SUBCOMMANDS = List.of("update", "version", "reasons", "link");
    private static final List<String> CATEGORIES = List.of("BAN", "MUTE", "KICK", "WARN");

    private final BackendConnector connector;
    private final Messages messages;
    private final String type;
    private final UpdateNotifier updates;
    private final ReasonCatalog reasons;
    private final PermissionSyncBridge luckPerms;

    StatusCommand(BackendConnector connector, Messages messages, String type, UpdateNotifier updates, ReasonCatalog reasons, PermissionSyncBridge luckPerms) {
        this.luckPerms = luckPerms;
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
        if (args.length > 0 && args[0].equalsIgnoreCase("link")) {
            link(source);
            return;
        }
        if (args.length > 0 && args[0].equalsIgnoreCase("reasons")) {
            if (!source.hasPermission(REASONS_PERMISSION) && !source.hasPermission(PERMISSION)) {
                source.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
                return;
            }
            listReasons(source, args);
            return;
        }
        if (!source.hasPermission(PERMISSION)) {
            source.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
            return;
        }
        StatusLines.render(messages, connector.status(), type).forEach(source::sendMessage);
    }

    /**
     * /nexora link: a one-time code for linking this Minecraft account to a
     * dashboard account. The proxy vouches for the authenticated session; the
     * backend decides eligibility (staff group mapping or nexora.dashboard.register).
     * The code is only sent to this player, never to public chat.
     */
    private void link(CommandSource source) {
        if (!(source instanceof com.velocitypowered.api.proxy.Player player)) {
            source.sendMessage(messages.prefixed("link.players-only", java.util.Map.of()));
            return;
        }
        java.util.concurrent.CompletableFuture<Void> fresh = luckPerms == null ? java.util.concurrent.CompletableFuture.completedFuture(null)
                : luckPerms.syncNow(player.getUniqueId()).exceptionally(e -> null);
        fresh.thenCompose(v -> {
            com.google.gson.JsonObject body = new com.google.gson.JsonObject();
            body.addProperty("uuid", player.getUniqueId().toString());
            body.addProperty("username", player.getUsername());
            body.addProperty("registerPermission", player.hasPermission(REGISTER_PERMISSION));
            return connector.client().post("/api/plugin/v1/link-codes", body);
        }).whenComplete((response, error) -> {
            if (error != null) {
                Throwable cause = error instanceof java.util.concurrent.CompletionException && error.getCause() != null ? error.getCause() : error;
                String key = cause instanceof dev.mnm.plugin.BackendException e ? switch (e.code()) {
                    case "LINKING_DISABLED" -> "link.disabled";
                    case "NOT_ELIGIBLE" -> "link.not-eligible";
                    case "TOO_MANY_CODES" -> "link.too-many";
                    default -> "error.request-failed";
                } : "error.backend-unavailable";
                player.sendMessage(messages.prefixed(key, java.util.Map.of("reason", cause.getMessage() == null ? "" : cause.getMessage())));
                return;
            }
            String code = response.get("code").getAsString();
            long minutes = Math.max(1, response.get("ttlSeconds").getAsLong() / 60);
            String url = response.has("dashboardUrl") && !response.get("dashboardUrl").isJsonNull() ? response.get("dashboardUrl").getAsString() : "";
            player.sendMessage(messages.prefixed("link.title", java.util.Map.of()));
            player.sendMessage(messages.render("link.code", java.util.Map.of("code", code))
                    .clickEvent(net.kyori.adventure.text.event.ClickEvent.copyToClipboard(code)));
            player.sendMessage(messages.render(url.isEmpty() ? "link.instructions" : "link.instructions-url", java.util.Map.of("url", url)));
            player.sendMessage(messages.render("link.expires", java.util.Map.of("minutes", String.valueOf(minutes))));
        });
    }

    static final String REGISTER_PERMISSION = "nexora.dashboard.register";

    /**
     * /nexora reasons [category] [page]: the reasons the sender may use (cached from
     * the backend, refreshed when presets change). Without a category every
     * category is summarised (first page each); with one it is paginated.
     */
    private void listReasons(CommandSource source, String[] args) {
        if (reasons == null || reasons.mode() == null) {
            source.sendMessage(messages.prefixed("reasons.unavailable", java.util.Map.of()));
            return;
        }
        if (reasons.mode() == ReasonCatalog.Mode.FREE_TEXT) {
            source.sendMessage(messages.prefixed("reasons.free-text-mode", java.util.Map.of()));
            return;
        }
        String category = args.length > 1 ? ReasonHelp.parseCategory(args[1]) : null;
        if (args.length > 1 && category == null) {
            source.sendMessage(messages.prefixed("error.usage", java.util.Map.of("usage", "/nexora reasons [ban|mute|kick|warn] [page]")));
            return;
        }
        if (category != null) {
            int page = 1;
            if (args.length > 2) {
                try {
                    page = Integer.parseInt(args[2]);
                } catch (NumberFormatException e) {
                    page = 1;
                }
            }
            String command = category.toLowerCase(Locale.ROOT);
            ModerationCommand.send(source, messages, ReasonHelp.lines(reasons.mode(), category, command, null, reasons.usable(category, source::hasPermission), page, source::hasPermission, messages::raw));
            return;
        }
        source.sendMessage(messages.prefixed("reasons.title", java.util.Map.of("mode", messages.raw("reasons.mode." + reasons.mode().name().toLowerCase(Locale.ROOT)))));
        boolean any = false;
        for (String cat : CATEGORIES) {
            List<ReasonCatalog.Preset> usable = reasons.usable(cat, source::hasPermission);
            if (usable.isEmpty()) continue;
            any = true;
            source.sendMessage(messages.render("reasons.category." + cat.toLowerCase(Locale.ROOT), java.util.Map.of()));
            ReasonHelp.Page<ReasonCatalog.Preset> first = ReasonHelp.page(usable, 1, ReasonHelp.PAGE_SIZE);
            boolean durations = cat.equals("BAN") || cat.equals("MUTE");
            for (ReasonCatalog.Preset p : first.items()) {
                ReasonHelp.Line line = ReasonHelp.entry(p, durations, messages::raw);
                source.sendMessage(messages.render(line.key(), line.vars()));
            }
            if (first.hasNext()) {
                source.sendMessage(messages.render("reasons.more", java.util.Map.of("count", String.valueOf(first.total() - first.items().size()), "command", "/nexora reasons " + cat.toLowerCase(Locale.ROOT) + " 2")));
            }
        }
        if (!any) source.sendMessage(messages.render("reasons.none", java.util.Map.of()));
    }

    @Override
    public List<String> suggest(Invocation invocation) {
        String[] args = invocation.arguments();
        if (args.length == 2 && args[0].equalsIgnoreCase("reasons")) {
            String partial = args[1].toLowerCase(Locale.ROOT);
            return CATEGORIES.stream().map(c -> c.toLowerCase(Locale.ROOT)).filter(c -> c.startsWith(partial)).toList();
        }
        if (args.length > 1) return List.of();
        String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
        return SUBCOMMANDS.stream().filter(a -> a.startsWith(prefix)).toList();
    }

    /**
     * Players may always run the command (for /nexora link – eligibility is
     * decided by the backend); every other subcommand checks its own permission.
     */
    @Override
    public boolean hasPermission(Invocation invocation) {
        CommandSource source = invocation.source();
        return source instanceof com.velocitypowered.api.proxy.Player || source.hasPermission(PERMISSION) || source.hasPermission(UpdateNotifier.CHECK_PERMISSION) || source.hasPermission(REASONS_PERMISSION);
    }

    /** Listing reasons (it only shows reasons the sender may use anyway). */
    static final String REASONS_PERMISSION = "nexora.command.reasons";
}
