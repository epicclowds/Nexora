package dev.mnm.paper.anticheat;

import dev.mnm.plugin.Messages;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.Arrays;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /anticheatban <player> <cheatType> <reason>} – explicit punishment
 * request, typically dispatched as console by AntiCheat plugins. The network's
 * rule for the cheat type (or the configured fallback) determines the
 * punishment. Requires {@code networkmanager.anticheat.command} (default: false,
 * console always has it), so regular players can never use it.
 */
public final class AntiCheatBanCommand implements BasicCommand {
    public static final String PERMISSION = "networkmanager.anticheat.command";

    private final AntiCheatBridge bridge;
    private final Messages messages;

    public AntiCheatBanCommand(AntiCheatBridge bridge, Messages messages) {
        this.bridge = bridge;
        this.messages = messages;
    }

    @Override
    public void execute(CommandSourceStack source, String[] args) {
        CommandSender sender = source.getSender();
        if (args.length < 3) {
            sender.sendMessage(messages.prefixed("error.usage", Map.of("usage", "/anticheatban <player> <cheatType> <reason>")));
            return;
        }
        String target = args[0];
        String cheatType = args[1];
        String reason = String.join(" ", Arrays.copyOfRange(args, 2, args.length));
        String provider = sender instanceof Player p ? "Command " + p.getName() : "Console";
        bridge.command(provider, target, cheatType, reason).whenComplete((result, error) -> {
            if (error != null) sender.sendMessage(messages.prefixed("error.backend-unavailable", Map.of()));
            else sender.sendMessage(messages.prefixed("anticheat.result", Map.of("player", target, "cheat", cheatType, "outcome", result.outcome().toLowerCase(Locale.ROOT))));
        });
    }

    @Override
    public Collection<String> suggest(CommandSourceStack source, String[] args) {
        if (args.length > 1) return java.util.List.of();
        String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
        return Bukkit.getOnlinePlayers().stream().map(Player::getName).filter(n -> n.toLowerCase(Locale.ROOT).startsWith(prefix)).toList();
    }

    @Override
    public boolean canUse(CommandSender sender) {
        return sender.hasPermission(PERMISSION);
    }

    @Override
    public String permission() {
        return PERMISSION;
    }
}
