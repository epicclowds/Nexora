package dev.mnm.velocity;

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.ManagedSettings;
import dev.mnm.plugin.Messages;
import dev.mnm.plugin.PluginConfig;
import dev.mnm.plugin.UpdateNotifier;
import dev.mnm.plugin.punish.ModerationClient;
import dev.mnm.plugin.punish.PunishmentCache;
import dev.mnm.plugin.punish.PunishmentFeed;
import dev.mnm.plugin.punish.PunishmentTexts;
import dev.mnm.plugin.punish.ReasonCatalog;
import java.nio.file.Path;
import java.time.Duration;
import org.slf4j.Logger;

/** Velocity proxy plugin: player sessions, server switches and proxy heartbeats. */
@Plugin(
        id = "networkmanager",
        name = "Network Manager",
        version = BuildInfo.VERSION,
        description = "Connects the Velocity proxy to the Network Manager platform",
        dependencies = {@com.velocitypowered.api.plugin.Dependency(id = "luckperms", optional = true)},
        authors = {"Network Manager contributors"})
public final class NetworkManagerVelocity {
    private final ProxyServer proxy;
    private final Logger logger;
    private final Path dataDirectory;
    private BackendConnector connector;

    @Inject
    public NetworkManagerVelocity(ProxyServer proxy, Logger logger, @DataDirectory Path dataDirectory) {
        this.proxy = proxy;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
    }

    @Subscribe
    public void onProxyInitialize(ProxyInitializeEvent event) {
        ClassLoader resources = getClass().getClassLoader();
        PluginConfig config;
        Messages messages;
        try {
            config = PluginConfig.loadOrCreate(dataDirectory, resources);
            messages = Messages.load(resources, config.language());
        } catch (Exception e) {
            logger.error("Network Manager is disabled: {}", e.getMessage());
            return;
        }

        ManagedSettings managed = new ManagedSettings(config, dataDirectory, logger);
        managed.bind(messages);
        SessionRegistry sessions = new SessionRegistry();
        connector = new BackendConnector(dataDirectory, config, new VelocityPlatform(proxy, sessions), BuildInfo.VERSION, logger);
        connector.useManagedSettings(managed);
        proxy.getEventManager().register(this, new PlayerListener(connector, sessions, config.collectIpAddresses()));
        // Update notifications: cached release info from the backend's heartbeat responses.
        UpdateNotifier updates = new UpdateNotifier(messages, BuildInfo.VERSION, config.updateNotifications(), true);
        connector.onHeartbeatResponse(updates::accept);
        proxy.getEventManager().register(this, new UpdateListener(proxy, this, updates));
        // Punishment reasons and the global command mode (dashboard), refreshed via heartbeat revisions.
        ReasonCatalog reasons = new ReasonCatalog(connector.client(), logger);
        connector.onHeartbeatResponse(reasons::accept);
        // Optional LuckPerms integration: staff permissions, ranks and account linking.
        PermissionSyncBridge luckPerms = PermissionSyncBridge.startIfAvailable(proxy, this, connector.client(), logger);
        if (luckPerms != null) {
            connector.onHeartbeatResponse(luckPerms::accept);
            proxy.getEventManager().register(this, com.velocitypowered.api.event.connection.PostLoginEvent.class, e -> luckPerms.onJoin(e.getPlayer()));
        }
        proxy.getCommandManager().register(
                proxy.getCommandManager().metaBuilder("networkmanager").aliases("nm", "nexora").plugin(this).build(),
                new StatusCommand(connector, messages, "VELOCITY", updates, reasons, luckPerms));
        // Punishments: local cache (login checks), change feed (actions), commands.
        if (config.punishmentsEnabled()) {
            PunishmentCache cache = new PunishmentCache();
            PunishmentTexts texts = new PunishmentTexts(messages, managed::appealUrl);
            Enforcer enforcer = new Enforcer(proxy, cache, texts, logger);
            PunishmentFeed feed = new PunishmentFeed(connector.client(), cache, dataDirectory, enforcer, logger);
            connector.every3Seconds(feed::poll);
            proxy.getEventManager().register(this, enforcer);
            if (config.moderationCommands()) {
                ModerationClient moderation = new ModerationClient(connector.client());
                for (ModerationCommand.Kind kind : ModerationCommand.Kind.values()) {
                    proxy.getCommandManager().register(
                            proxy.getCommandManager().metaBuilder(kind.command()).plugin(this).build(),
                            new ModerationCommand(kind, proxy, moderation, texts, enforcer, reasons));
                }
            }
        } else {
            logger.warn("punishments-enabled=false: network bans and mutes are NOT enforced on this proxy.");
        }

        connector.start();
    }

    @Subscribe(priority = Short.MIN_VALUE)
    public void onProxyShutdown(ProxyShutdownEvent event) {
        if (connector != null) connector.stop(Duration.ofSeconds(5));
    }
}
