package dev.mnm.paper;

import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.PluginConfig;
import dev.mnm.plugin.StatusLines;
import dev.mnm.plugin.punish.PunishmentCache;
import dev.mnm.plugin.punish.PunishmentFeed;
import dev.mnm.plugin.punish.PunishmentTexts;
import dev.mnm.paper.stats.ActivityTracker;
import dev.mnm.paper.stats.StatisticsCollector;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.List;
import org.bukkit.command.CommandSender;
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

        connector = new BackendConnector(getDataFolder().toPath(), config, new PaperPlatform(this), getPluginMeta().getVersion(), getSLF4JLogger());
        BackendConnector statusSource = connector;
        getLifecycleManager().registerEventHandler(LifecycleEvents.COMMANDS, event -> event.registrar().register(
                "networkmanager",
                "Shows the Network Manager connection status",
                List.of("nm"),
                new BasicCommand() {
                    @Override
                    public void execute(CommandSourceStack source, String[] args) {
                        StatusLines.render(messages, statusSource.status(), "PAPER").forEach(source.getSender()::sendMessage);
                    }

                    @Override
                    public boolean canUse(CommandSender sender) {
                        return sender.hasPermission(ADMIN_PERMISSION);
                    }

                    @Override
                    public String permission() {
                        return ADMIN_PERMISSION;
                    }
                }));
        // Mutes are enforced here (chat); bans and kicks are handled by the proxy.
        PunishmentCache cache = new PunishmentCache();
        PunishmentTexts texts = new PunishmentTexts(messages);
        PunishmentFeed feed = new PunishmentFeed(connector.client(), cache, getDataFolder().toPath(), punishment -> {}, getSLF4JLogger());
        connector.every3Seconds(feed::poll);
        getServer().getPluginManager().registerEvents(new ChatMuteListener(cache, texts), this);

        if (config.statisticsEnabled()) {
            ActivityTracker activity = new ActivityTracker(this, config.afkTimeoutSeconds());
            StatisticsCollector statistics = new StatisticsCollector(connector.client(), activity, config.statisticsCategories(), getSLF4JLogger());
            getServer().getPluginManager().registerEvents(activity, this);
            getServer().getPluginManager().registerEvents(statistics, this);
            getServer().getScheduler().runTaskTimer(this, activity::tick, 20L, 20L);
            getServer().getScheduler().runTaskTimer(this, statistics::tick, 1L, 1L);
            long interval = config.statisticsIntervalSeconds() * 20L;
            getServer().getScheduler().runTaskTimer(this, statistics::startRound, interval, interval);
        }

        connector.start();
    }

    @Override
    public void onDisable() {
        if (connector != null) connector.stop(Duration.ofSeconds(5));
    }
}
