package dev.mnm.velocity;

import com.google.gson.JsonObject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.PostLoginEvent;
import com.velocitypowered.api.event.player.PlayerClientBrandEvent;
import com.velocitypowered.api.event.player.ServerConnectedEvent;
import com.velocitypowered.api.proxy.Player;
import dev.mnm.plugin.BackendConnector;
import java.net.InetSocketAddress;
import java.util.UUID;

/**
 * Translates proxy events into backend events. Handlers only enqueue work, so
 * they never block Velocity's event threads on network I/O.
 */
final class PlayerListener {
    private final BackendConnector connector;
    private final SessionRegistry sessions;
    private final boolean collectIp;

    PlayerListener(BackendConnector connector, SessionRegistry sessions, boolean collectIp) {
        this.connector = connector;
        this.sessions = sessions;
        this.collectIp = collectIp;
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
        connector.enqueue(e);
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
        sessions.get(player.getUniqueId()).ifPresent(sessionKey -> {
            JsonObject e = base("player.brand", sessionKey, player);
            String brand = event.getBrand();
            e.addProperty("brand", brand.length() > 128 ? brand.substring(0, 128) : brand);
            connector.enqueue(e);
        });
    }

    @Subscribe(priority = Short.MIN_VALUE)
    public void onDisconnect(DisconnectEvent event) {
        Player player = event.getPlayer();
        // Only players that completed login have a session.
        sessions.close(player.getUniqueId()).ifPresent(sessionKey -> {
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
