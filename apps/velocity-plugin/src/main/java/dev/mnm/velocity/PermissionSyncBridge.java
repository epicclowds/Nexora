package dev.mnm.velocity;

import com.google.gson.JsonObject;
import com.velocitypowered.api.proxy.Player;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Indirection so that LuckPerms classes are only loaded when LuckPerms is
 * installed ({@link LuckPermsSync} implements it).
 */
interface PermissionSyncBridge {
    void accept(JsonObject heartbeat);

    CompletableFuture<Void> syncNow(UUID uuid);

    void onJoin(Player player);

    String version();

    /** Starts the LuckPerms synchronisation, or returns null when LuckPerms is not installed. */
    static PermissionSyncBridge startIfAvailable(com.velocitypowered.api.proxy.ProxyServer proxy, Object plugin, dev.mnm.plugin.BackendClient client, org.slf4j.Logger logger) {
        if (proxy.getPluginManager().getPlugin("luckperms").isEmpty()) return null;
        try {
            return LuckPermsSync.start(proxy, plugin, client, logger);
        } catch (LinkageError | IllegalStateException e) {
            logger.warn("LuckPerms is installed but its API could not be used: {}", e.getMessage());
            return null;
        }
    }
}
