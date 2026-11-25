package dev.mnm.velocity;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.ProcessMetrics;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

final class VelocityPlatform implements BackendConnector.Platform {
    private final ProxyServer proxy;
    private final SessionRegistry sessions;

    VelocityPlatform(ProxyServer proxy, SessionRegistry sessions) {
        this.proxy = proxy;
        this.sessions = sessions;
    }

    @Override
    public String type() {
        return "VELOCITY";
    }

    @Override
    public String platformVersion() {
        return proxy.getVersion().getName() + " " + proxy.getVersion().getVersion();
    }

    @Override
    public String minecraftVersion() {
        return null;
    }

    /** Velocity APIs used here are thread-safe, so no thread hop is needed. */
    @Override
    public CompletableFuture<JsonObject> heartbeat() {
        JsonObject body = new JsonObject();
        body.addProperty("onlinePlayers", proxy.getPlayerCount());
        body.addProperty("maxPlayers", proxy.getConfiguration().getShowMaxPlayers());
        ProcessMetrics.addTo(body);
        return CompletableFuture.completedFuture(body);
    }

    @Override
    public Optional<JsonArray> sessions() {
        JsonArray list = new JsonArray();
        for (Player player : proxy.getAllPlayers()) {
            sessions.get(player.getUniqueId()).ifPresent(sessionKey -> {
                JsonObject s = new JsonObject();
                s.addProperty("sessionKey", sessionKey.toString());
                s.addProperty("uuid", player.getUniqueId().toString());
                s.addProperty("username", player.getUsername());
                player.getCurrentServer().ifPresent(server -> s.addProperty("server", server.getServerInfo().getName()));
                String brand = dev.mnm.plugin.client.ClientDetection.clean(player.getClientBrand());
                if (brand != null) s.addProperty("brand", brand);
                list.add(s);
            });
        }
        return Optional.of(list);
    }
}
