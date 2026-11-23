package dev.mnm.paper;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.mnm.plugin.BackendConnector;
import dev.mnm.plugin.ProcessMetrics;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

final class PaperPlatform implements BackendConnector.Platform {
    private final Plugin plugin;

    PaperPlatform(Plugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public String type() {
        return "PAPER";
    }

    @Override
    public String platformVersion() {
        return Bukkit.getName() + " " + Bukkit.getVersion();
    }

    @Override
    public String minecraftVersion() {
        return Bukkit.getMinecraftVersion();
    }

    /**
     * Player and tick data must be read on the server thread; the snapshot is
     * taken there and the HTTP call continues asynchronously.
     */
    @Override
    public CompletableFuture<JsonObject> heartbeat() {
        CompletableFuture<JsonObject> future = new CompletableFuture<>();
        if (!plugin.isEnabled()) {
            future.completeExceptionally(new IllegalStateException("plugin disabled"));
            return future;
        }
        try {
            Bukkit.getScheduler().runTask(plugin, () -> {
                try {
                    future.complete(snapshot());
                } catch (RuntimeException e) {
                    future.completeExceptionally(e);
                }
            });
        } catch (RuntimeException e) {
            future.completeExceptionally(e);
        }
        return future;
    }

    private static JsonObject snapshot() {
        JsonObject body = new JsonObject();
        body.addProperty("onlinePlayers", Bukkit.getOnlinePlayers().size());
        body.addProperty("maxPlayers", Bukkit.getMaxPlayers());
        double tps = Bukkit.getTPS()[0];
        body.addProperty("tps", Math.round(Math.min(tps, 1000) * 100) / 100.0);
        body.addProperty("mspt", Math.round(Bukkit.getAverageTickTime() * 100) / 100.0);
        JsonArray players = new JsonArray();
        for (Player player : Bukkit.getOnlinePlayers()) {
            JsonObject p = new JsonObject();
            p.addProperty("uuid", player.getUniqueId().toString());
            p.addProperty("gamemode", player.getGameMode().name());
            players.add(p);
        }
        body.add("players", players);
        ProcessMetrics.addTo(body);
        return body;
    }
}
