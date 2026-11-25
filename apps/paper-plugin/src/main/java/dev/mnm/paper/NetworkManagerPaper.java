package dev.mnm.paper;

import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.ManagedSettings;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.PluginConfig;
import dev.mnm.plugin.StatusLines;
import dev.mnm.plugin.UpdateNotifier;
import java.time.Instant;
import java.util.Locale;
import dev.mnm.plugin.punish.PunishmentCache;
import dev.mnm.plugin.punish.PunishmentFeed;
import dev.mnm.plugin.punish.PunishmentTexts;
import dev.mnm.paper.anticheat.AntiCheatBanCommand;
import dev.mnm.paper.anticheat.AntiCheatBridge;
import dev.mnm.paper.api.AntiCheatApi;
import dev.mnm.paper.inventory.InventorySync;
import dev.mnm.paper.stats.ActivityTracker;
import dev.mnm.paper.stats.StatisticsCollector;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.List;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.java.JavaPlugin;

/** Paper backend-server plugin: server heartbeats (TPS, MSPT, memory) and per-player game state. */
public final class NetworkManagerPaper extends JavaPlugin {
    static final String ADMIN_PERMISSION = "networkmanager.admin";

    private BackendConnector connector;

    @Override
    public void onEnable() {
        PluginConfig config;
        Messages messages;
        try {
            config = PluginConfig.loadOrCreate(getDataFolder().toPath(), getClassLoader());
            messages = Messages.load(getClassLoader(), config.language());
        } catch (Exception e) {
            getSLF4JLogger().error("Network Manager is disabled: {}", e.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        ManagedSettings managed = new ManagedSettings(config, getDataFolder().toPath(), getSLF4JLogger());
        managed.bind(messages);
        connector = new BackendConnector(getDataFolder().toPath(), config, new PaperPlatform(this), getPluginMeta().getVersion(), getSLF4JLogger());
        connector.useManagedSettings(managed);
        BackendConnector statusSource = connector;
        // Update information from the backend's heartbeat responses. In-game notifications are off on
        // Paper by default (update-notifications=auto): the Velocity proxy notifies the network once.
        UpdateNotifier updates = new UpdateNotifier(messages, getPluginMeta().getVersion(), config.updateNotifications(), false);
        connector.onHeartbeatResponse(updates::accept);
        getServer().getPluginManager().registerEvents(new UpdateJoinListener(this, updates), this);
        getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> event.registrar().register(
                "networkmanager",
                "Shows the Network Manager connection status (\"update\": update information)",
                List.of("nm", "nexora"),
                new BasicCommand() {
                    @Override
                    public void execute(CommandSourceStack source, String[] args) {
                        CommandSender sender = source.getSender();
                        if (args.length > 0 && List.of("update", "version").contains(args[0].toLowerCase(Locale.ROOT))) {
                            if (!sender.hasPermission(UpdateNotifier.CHECK_PERMISSION) && !sender.hasPermission(ADMIN_PERMISSION)) {
                                sender.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
                                return;
                            }
                            updates.infoLines(Instant.now()).forEach(sender::sendMessage);
                            return;
                        }
                        if (!sender.hasPermission(ADMIN_PERMISSION)) {
                            sender.sendMessage(messages.prefixed("error.no-permission", java.util.Map.of()));
                            return;
                        }
                        StatusLines.render(messages, statusSource.status(), "PAPER").forEach(sender::sendMessage);
                    }

                    @Override
                    public java.util.Collection<String> suggest(CommandSourceStack source, String[] args) {
                        if (args.length > 1) return List.of();
                        String prefix = args.length == 0 ? "" : args[0].toLowerCase(Locale.ROOT);
                        return List.of("update", "version").stream().filter(a -> a.startsWith(prefix)).toList();
                    }

                    @Override
                    public boolean canUse(CommandSender sender) {
                        return sender.hasPermission(ADMIN_PERMISSION) || sender.hasPermission(UpdateNotifier.CHECK_PERMISSION);
                    }
                }));
        // Mutes are enforced here (chat); bans and kicks are handled by the proxy.
        PunishmentTexts texts = new PunishmentTexts(messages);
        if (config.punishmentsEnabled()) {
            PunishmentCache cache = new PunishmentCache();
            PunishmentFeed feed = new PunishmentFeed(connector.client(), cache, getDataFolder().toPath(), punishment -> {}, getSLF4JLogger());
            connector.every3Seconds(feed::poll);
            getServer().getPluginManager().registerEvents(new ChatMuteListener(cache, texts), this);
        } else {
            getSLF4JLogger().warn("punishments-enabled=false: network mutes are NOT enforced on this server.");
        }

        // AntiCheat: Java API (allow-listed integrations) and /anticheatban.
        AntiCheatBridge anticheat = new AntiCheatBridge(this, connector.client(), config.anticheatIntegrations(), config.anticheatMaxReportsPerMinute(), texts, getSLF4JLogger());
        getServer().getServicesManager().register(AntiCheatApi.class, anticheat, this, ServicePriority.Normal);
        getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> event.registrar().register(
                "anticheatban", "Requests an AntiCheat punishment according to the network rules", List.of(), new AntiCheatBanCommand(anticheat, messages)));

        // Inventories and statistics follow the managed settings live: the
        // components are always registered and check the effective values,
        // and intervals are re-read on every timer check.
        InventorySync inventories = new InventorySync(this, connector.client(), managed::inventorySync, managed::enderChestSync, getSLF4JLogger());
        getServer().getPluginManager().registerEvents(inventories, this);
        connector.every3Seconds(inventories::poll);
        getServer().getScheduler().runTaskTimer(this, new IntervalTask(managed::inventorySyncIntervalSeconds, inventories::snapshotAll), 20L, 20L);

        ActivityTracker activity = new ActivityTracker(this, config.afkTimeoutSeconds());
        StatisticsCollector statistics = new StatisticsCollector(connector.client(), activity, managed::statisticsCategories, managed::statisticsEnabled, getSLF4JLogger());
        getServer().getPluginManager().registerEvents(activity, this);
        getServer().getPluginManager().registerEvents(statistics, this);
        getServer().getScheduler().runTaskTimer(this, () -> {
            if (managed.statisticsEnabled()) activity.tick();
        }, 20L, 20L);
        getServer().getScheduler().runTaskTimer(this, statistics::tick, 1L, 1L);
        getServer().getScheduler().runTaskTimer(this, new IntervalTask(managed::statisticsIntervalSeconds, statistics::startRound), 20L, 20L);

        connector.start();
    }

    @Override
    public void onDisable() {
        if (connector != null) connector.stop(Duration.ofSeconds(5));
    }
}
