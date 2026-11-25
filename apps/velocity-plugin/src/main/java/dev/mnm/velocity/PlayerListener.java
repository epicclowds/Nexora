package dev.mnm.velocity;

import com.google.gson.JsonObject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.PostLoginEvent;
import com.velocitypowered.api.event.player.PlayerClientBrandEvent;
import com.velocitypowered.api.event.player.ServerConnectedEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.client.ClientDetection;
import java.net.InetSocketAddress;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Translates proxy events into backend events. Handlers only enqueue work, so
 * they never block Velocity's event threads on network I/O.
 */
final class PlayerListener {
    private final BackendConnector connector;
    private final SessionRegistry sessions;
    private final boolean collectIp;
    private final ClientDetection clients;
    private final ProxyServer proxy;
    private final Object plugin;
    /** Optional NoRisk Client server API; null when not installed. */
    private final NoRiskBridge norisk;

    PlayerListener(BackendConnector connector, SessionRegistry sessions, boolean collectIp, ClientDetection clients, ProxyServer proxy, Object plugin, NoRiskBridge norisk) {
        this.connector = connector;
        this.sessions = sessions;
        this.collectIp = collectIp;
        this.clients = clients;
        this.proxy = proxy;
        this.plugin = plugin;
        this.norisk = norisk;
    }

    @Subscribe(priority = Short.MIN_VALUE)
    public void onPostLogin(PostLoginEvent event) {
        Player player = event.getPlayer();
        UUID sessionKey = sessions.open(player.getUniqueId());
        JsonObject e = base("player.join", sessionKey, player);
        e.addProperty("username", player.getUsername());
        e.addProperty("at", System.currentTimeMillis());
        if (collectIp) {
            InetSocketAddress remote = player.getRemoteAddress();
            if (remote != null && remote.getAddress() != null) e.addProperty("ip", remote.getAddress().getHostAddress());
        }
        player.getVirtualHost().ifPresent(host -> e.addProperty("virtualHost", host.getHostString()));
        e.addProperty("protocol", player.getProtocolVersion().getProtocol());
        e.addProperty("clientVersion", player.getProtocolVersion().getMostRecentSupportedVersion());
        // Skin texture (base64 JSON from the game profile); the backend only accepts textures.minecraft.net URLs.
        player.getGameProfileProperties().stream()
                .filter(p -> "textures".equals(p.getName()) && p.getValue() != null && p.getValue().length() <= 8192)
                .findFirst()
                .ifPresent(p -> e.addProperty("textures", p.getValue()));
        // Modern clients send their brand during the configuration phase, which can complete
        // before PostLoginEvent reaches this (last-priority) handler. The brand event then found
        // no session and was dropped; Velocity keeps the brand on the player, so it goes with the join.
        clients.brandToSend(sessionKey, player.getClientBrand()).ifPresent(brand -> e.addProperty("brand", brand));
        connector.enqueue(e);
        scheduleClientChecks(player, sessionKey);
    }

    /** NoRisk API checks (after its handshake) and a debug note when no brand arrives. */
    private void scheduleClientChecks(Player player, UUID sessionKey) {
        UUID uuid = player.getUniqueId();
        if (norisk != null && clients.noriskEnabled()) {
            for (long delay : new long[] {2, 8}) {
                proxy.getScheduler().buildTask(plugin, () -> checkNoRisk(uuid, sessionKey)).delay(delay, TimeUnit.SECONDS).schedule();
            }
        }
        if (clients.debugEnabled()) {
            proxy.getScheduler().buildTask(plugin, () -> {
                if (sessions.get(uuid).filter(sessionKey::equals).isPresent() && !clients.hasBrand(sessionKey)) {
                    clients.debug("session {}: no client brand received within 10 seconds (shown as Unknown)", sessionKey);
                }
            }).delay(10, TimeUnit.SECONDS).schedule();
        }
    }

    private void checkNoRisk(UUID uuid, UUID sessionKey) {
        if (sessions.get(uuid).filter(sessionKey::equals).isEmpty() || !clients.noriskEnabled()) return; // left or relogged
        norisk.isNoRiskPlayer(uuid).ifPresent(isNoRisk -> {
            clients.debug("session {}: NoRisk Client server API answered {}", sessionKey, isNoRisk);
            if (!isNoRisk || !clients.firstIntegrationReport(sessionKey)) return;
            JsonObject e = new JsonObject();
            e.addProperty("type", "player.client");
            e.addProperty("sessionKey", sessionKey.toString());
            e.addProperty("uuid", uuid.toString());
            e.addProperty("client", "norisk");
            e.addProperty("source", "INTEGRATION");
            e.addProperty("at", System.currentTimeMillis());
            connector.enqueue(e);
        });
    }

    @Subscribe(priority = Short.MIN_VALUE)
    public void onServerConnected(ServerConnectedEvent event) {
        Player player = event.getPlayer();
        sessions.get(player.getUniqueId()).ifPresent(sessionKey -> {
            JsonObject e = base("player.switch", sessionKey, player);
            e.addProperty("server", event.getServer().getServerInfo().getName());
            e.addProperty("at", System.currentTimeMillis());
            connector.enqueue(e);
        });
    }

    @Subscribe(priority = Short.MIN_VALUE)
    public void onClientBrand(PlayerClientBrandEvent event) {
        Player player = event.getPlayer();
        sessions.get(player.getUniqueId()).ifPresentOrElse(
                sessionKey -> clients.brandToSend(sessionKey, event.getBrand()).ifPresent(brand -> {
                    JsonObject e = base("player.brand", sessionKey, player);
                    e.addProperty("brand", brand);
                    connector.enqueue(e);
                }),
                // Before login completed: the join event picks it up from the player.
                () -> {
                    if (clients.debugEnabled()) clients.debug("brand \"{}\" arrived before login completed; sent with the join", ClientDetection.clean(event.getBrand()));
                });
    }

    @Subscribe(priority = Short.MIN_VALUE)
    public void onDisconnect(DisconnectEvent event) {
        Player player = event.getPlayer();
        // Only players that completed login have a session.
        sessions.close(player.getUniqueId()).ifPresent(sessionKey -> {
            clients.sessionClosed(sessionKey);
            JsonObject e = base("player.leave", sessionKey, player);
            e.addProperty("at", System.currentTimeMillis());
            connector.enqueue(e);
        });
    }

    private static JsonObject base(String type, UUID sessionKey, Player player) {
        JsonObject e = new JsonObject();
        e.addProperty("type", type);
        e.addProperty("sessionKey", sessionKey.toString());
        e.addProperty("uuid", player.getUniqueId().toString());
        return e;
    }
}
