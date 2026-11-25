package dev.mnm.paper;

import dev.mnm.plugin.UpdateNotifier;
import java.time.Instant;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.Plugin;

/**
 * Optional update notification on Paper servers (update-notifications=true;
 * by default the Velocity proxy notifies the network once). Cached data only.
 */
final class UpdateJoinListener implements Listener {
    private final Plugin plugin;
    private final UpdateNotifier notifier;

    UpdateJoinListener(Plugin plugin, UpdateNotifier notifier) {
        this.plugin = plugin;
        this.notifier = notifier;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        if (!notifier.shouldNotify(player.getUniqueId(), player.hasPermission(UpdateNotifier.NOTIFY_PERMISSION), Instant.now())) return;
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            if (player.isOnline()) notifier.notificationLines().forEach(player::sendMessage);
        }, 60L);
    }
}
