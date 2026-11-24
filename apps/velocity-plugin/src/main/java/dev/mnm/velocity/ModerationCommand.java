package dev.mnm.velocity;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.mnm.plugin.BackendException;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.punish.CachedPunishment;
import dev.mnm.plugin.punish.Durations;
import dev.mnm.plugin.punish.EditArguments;
import dev.mnm.plugin.punish.ModerationClient;
import dev.mnm.plugin.punish.PunishmentTexts;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

/**
 * Network-wide moderation commands. Every punishment goes through the backend
 * (single source of truth); on success it is applied locally right away.
 * Permission: {@code networkmanager.command.<name>}.
 */
final class ModerationCommand implements SimpleCommand {
    enum Kind {
        BAN("<player> <reason>", 2),
        TEMPBAN("<player> <duration> <reason>", 3),
        UNBAN("<player> [reason]", 1),
        MUTE("<player> <reason>", 2),
        TEMPMUTE("<player> <duration> <reason>", 3),
        UNMUTE("<player> [reason]", 1),
        KICK("<player> <reason>", 2),
        WARN("<player> <reason>", 2),
        HISTORY("<player>", 1),
        CHECK("<player>", 1),
        EDITBAN("<player|#id> <duration|permanent|keep> [reason]", 2),
        EDITMUTE("<player|#id> <duration|permanent|keep> [reason]", 2);

        final String usage;
        final int minArgs;

        Kind(String usage, int minArgs) {
            this.usage = usage;
            this.minArgs = minArgs;
        }

        String command() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    private static final int HISTORY_LIMIT = 10;

    private final Kind kind;
    private final ProxyServer proxy;
    private final ModerationClient client;
    private final PunishmentTexts texts;
    private final Messages messages;
    private final Enforcer enforcer;

    ModerationCommand(Kind kind, ProxyServer proxy, ModerationClient client, PunishmentTexts texts, Enforcer enforcer) {
        this.kind = kind;
        this.proxy = proxy;
        this.client = client;
        this.texts = texts;
        this.messages = texts.messages();
        this.enforcer = enforcer;
    }

    @Override
    public boolean hasPermission(Invocation invocation) {
        return invocation.source().hasPermission("networkmanager.command." + kind.command());
    }

    @Override
    public List<String> suggest(Invocation invocation) {
        String[] args = invocation.arguments();
        if (args.length == 2 && (kind == Kind.EDITBAN || kind == Kind.EDITMUTE)) {
            String partial = args[1].toLowerCase(Locale.ROOT);
            return EditArguments.DURATION_SUGGESTIONS.stream().filter(s -> s.startsWith(partial)).toList();
        }
        if (args.length > 1) return List.of();
        String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
        return proxy.getAllPlayers().stream().map(Player::getUsername).filter(n -> n.toLowerCase(Locale.ROOT).startsWith(prefix)).sorted().limit(50).toList();
    }

    @Override
    public void execute(Invocation invocation) {
        CommandSource source = invocation.source();
        String[] args = invocation.arguments();
        if (args.length < kind.minArgs) {
            source.sendMessage(messages.prefixed("error.usage", Map.of("usage", "/" + invocation.alias() + " " + kind.usage)));
            return;
        }
        String target = args[0];
        ModerationClient.Actor actor = source instanceof Player p ? new ModerationClient.Actor(p.getUniqueId(), p.getUsername()) : ModerationClient.Actor.console();

        switch (kind) {
            case BAN -> punish(source, "BAN", target, join(args, 1), null);
            case MUTE -> punish(source, "MUTE", target, join(args, 1), null);
            case KICK -> punish(source, "KICK", target, join(args, 1), null);
            case WARN -> punish(source, "WARNING", target, join(args, 1), null);
            case TEMPBAN, TEMPMUTE -> {
                Optional<Duration> duration = Durations.parse(args[1]);
                if (duration.isEmpty()) {
                    source.sendMessage(messages.prefixed("error.invalid-duration", Map.of("input", args[1])));
                    return;
                }
                punish(source, kind == Kind.TEMPBAN ? "TEMP_BAN" : "TEMP_MUTE", target, join(args, 2), duration.get());
            }
            case UNBAN, UNMUTE -> {
                String revokeKind = kind == Kind.UNBAN ? "BAN" : "MUTE";
                handle(source, target, client.revoke(revokeKind, target, join(args, 1), actor), response -> source.sendMessage(
                        messages.prefixed(kind == Kind.UNBAN ? "command.unban.success" : "command.unmute.success", Map.of("player", targetName(response, target)))));
            }
            case HISTORY -> handle(source, target, client.lookup(target, HISTORY_LIMIT), response -> history(source, response));
            case CHECK -> handle(source, target, client.lookup(target, 1), response -> check(source, response));
            case EDITBAN, EDITMUTE -> edit(source, invocation.alias(), args, actor);
        }
    }

    private void punish(CommandSource source, String type, String target, String reason, Duration duration) {
        ModerationClient.Actor actor = source instanceof Player p ? new ModerationClient.Actor(p.getUniqueId(), p.getUsername()) : ModerationClient.Actor.console();
        CompletableFuture<JsonObject> request = client.punish(type, target, reason, duration == null ? null : duration.toSeconds(), actor);
        handle(source, target, request, response -> {
            enforcer.apply(toCached(response));
            String key = switch (type) {
                case "BAN" -> "command.ban.success";
                case "TEMP_BAN" -> "command.tempban.success";
                case "MUTE" -> "command.mute.success";
                case "TEMP_MUTE" -> "command.tempmute.success";
                case "KICK" -> "command.kick.success";
                default -> "command.warn.success";
            };
            source.sendMessage(messages.prefixed(key, Map.of(
                    "player", targetName(response, target),
                    "id", response.get("id").getAsString(),
                    "duration", duration == null ? "" : Durations.format(duration))));
        });
    }

    /**
     * /editban and /editmute: changes the existing punishment in place (never a
     * second one). Converting temporary ↔ permanent additionally needs
     * networkmanager.command.<name>.permanent (enforced by the backend for the
     * change that is actually planned).
     */
    private void edit(CommandSource source, String alias, String[] args, ModerationClient.Actor actor) {
        EditArguments.Result parsed = EditArguments.parse(args);
        if (parsed.arguments() == null) {
            String key = parsed.errorKey();
            source.sendMessage(messages.prefixed(key, Map.of("usage", "/" + alias + " " + kind.usage, "input", parsed.input())));
            return;
        }
        EditArguments a = parsed.arguments();
        String editKind = kind == Kind.EDITBAN ? "BAN" : "MUTE";
        boolean allowPermanent = source.hasPermission("networkmanager.command." + kind.command() + ".permanent");
        String shownTarget = a.id() != null ? "#" + a.id() : a.target();
        handle(source, shownTarget, client.edit(new ModerationClient.Edit(editKind, a.target(), a.id(), a.duration(), a.reason()), allowPermanent, actor), response -> {
            JsonObject punishment = response.getAsJsonObject("punishment");
            JsonObject previous = response.getAsJsonObject("previous");
            enforcer.refresh(toCached(punishment));
            source.sendMessage(messages.prefixed("command.edit.success", Map.of(
                    "type", texts.typeName(punishment.get("type").getAsString()),
                    "id", punishment.get("id").getAsString(),
                    "player", targetName(punishment, shownTarget))));
            String oldExpiry = previous.get("expiresAt").isJsonNull() ? null : previous.get("expiresAt").getAsString();
            String newExpiry = punishment.get("expiresAt").isJsonNull() ? null : punishment.get("expiresAt").getAsString();
            if (!java.util.Objects.equals(oldExpiry, newExpiry)) {
                source.sendMessage(messages.render("command.edit.duration", Map.of("old", texts.formatInstant(epoch(oldExpiry)), "new", texts.formatInstant(epoch(newExpiry)))));
            }
            String oldReason = previous.get("reason").getAsString();
            String newReason = punishment.get("reason").getAsString();
            if (!oldReason.equals(newReason)) source.sendMessage(messages.render("command.edit.reason", Map.of("old", oldReason, "new", newReason)));
        });
    }

    private static Long epoch(String iso) {
        return iso == null ? null : Instant.parse(iso).toEpochMilli();
    }

    private void history(CommandSource source, JsonObject response) {
        String name = response.getAsJsonObject("player").get("username").getAsString();
        int total = response.get("total").getAsInt();
        if (total == 0) {
            source.sendMessage(messages.prefixed("command.history.empty", Map.of("player", name)));
            return;
        }
        source.sendMessage(messages.prefixed("command.history.header", Map.of("player", name, "count", String.valueOf(total))));
        for (JsonElement e : response.getAsJsonArray("history")) {
            JsonObject p = e.getAsJsonObject();
            source.sendMessage(messages.render("command.history.entry", Map.of(
                    "id", p.get("id").getAsString(),
                    "type", texts.typeName(p.get("type").getAsString()),
                    "reason", p.get("reason").getAsString(),
                    "date", texts.formatInstant(Instant.parse(p.get("createdAt").getAsString()).toEpochMilli()),
                    "issuer", p.getAsJsonObject("issuer").get("name").getAsString(),
                    "status", texts.stateName(p.get("status").getAsString()))));
        }
        if (total > HISTORY_LIMIT) source.sendMessage(messages.render("command.history.more", Map.of("count", String.valueOf(total - HISTORY_LIMIT))));
    }

    private void check(CommandSource source, JsonObject response) {
        String name = response.getAsJsonObject("player").get("username").getAsString();
        source.sendMessage(messages.prefixed("command.check.header", Map.of("player", name)));
        JsonObject active = response.getAsJsonObject("active");
        boolean any = false;
        for (String slot : List.of("ban", "mute")) {
            if (active.get(slot).isJsonNull()) continue;
            any = true;
            JsonObject p = active.getAsJsonObject(slot);
            Long expires = p.get("expiresAt").isJsonNull() ? null : Instant.parse(p.get("expiresAt").getAsString()).toEpochMilli();
            source.sendMessage(messages.render(slot.equals("ban") ? "command.check.banned" : "command.check.muted",
                    Map.of("reason", p.get("reason").getAsString(), "expires", texts.formatInstant(expires))));
        }
        if (!any) source.sendMessage(messages.render("command.check.clean", Map.of()));
    }

    /** Runs the request and translates backend errors into player-facing messages. */
    private void handle(CommandSource source, String target, CompletableFuture<JsonObject> request, java.util.function.Consumer<JsonObject> onSuccess) {
        request.whenComplete((response, error) -> {
            if (error == null) {
                onSuccess.accept(response);
                return;
            }
            Throwable cause = error instanceof CompletionException && error.getCause() != null ? error.getCause() : error;
            if (!(cause instanceof BackendException e) || e.status() == 0) {
                source.sendMessage(messages.prefixed("error.backend-unavailable", Map.of()));
                return;
            }
            Map<String, String> vars = Map.of("player", target, "reason", e.getMessage(), "input", target);
            String key = switch (e.code()) {
                case "PLAYER_NOT_FOUND" -> "error.player-not-found";
                case "ALREADY_BANNED" -> "error.already-banned";
                case "ALREADY_MUTED" -> "error.already-muted";
                case "PLAYER_OFFLINE" -> "error.player-offline";
                case "NOT_BANNED", "NOT_MUTED" -> "command.not-punished";
                case "NO_CHANGES" -> "error.no-changes";
                case "DURATION_ALREADY_ELAPSED" -> "error.duration-elapsed";
                case "INVALID_DURATION" -> "error.invalid-duration";
                case "NOT_ACTIVE" -> "error.not-active";
                case "PUNISHMENT_NOT_FOUND" -> "error.punishment-not-found";
                case "PERMANENT_NOT_ALLOWED" -> "error.permanent-permission";
                case "WRONG_PUNISHMENT_TYPE" -> "error.wrong-punishment-type";
                default -> "error.request-failed";
            };
            source.sendMessage(messages.prefixed(key, vars));
        });
    }

    private static CachedPunishment toCached(JsonObject r) {
        JsonObject target = r.getAsJsonObject("target");
        return new CachedPunishment(
                r.get("id").getAsString(),
                r.get("type").getAsString(),
                UUID.fromString(target.get("uuid").getAsString()),
                target.get("username").getAsString(),
                null,
                r.get("reason").getAsString(),
                r.getAsJsonObject("issuer").get("name").getAsString(),
                Instant.parse(r.get("createdAt").getAsString()).toEpochMilli(),
                r.get("expiresAt").isJsonNull() ? null : Instant.parse(r.get("expiresAt").getAsString()).toEpochMilli());
    }

    private static String targetName(JsonObject response, String fallback) {
        if (response.has("target")) return response.getAsJsonObject("target").get("username").getAsString();
        return fallback;
    }

    private static String join(String[] args, int from) {
        return String.join(" ", Arrays.copyOfRange(args, Math.min(from, args.length), args.length)).trim();
    }
}
