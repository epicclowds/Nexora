package dev.mnm.velocity;

import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.PostLoginEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.mnm.plugin.UpdateNotifier;
import java.time.Duration;
import java.time.Instant;

/**
 * Tells staff with {@code networkmanager.update.notify} about a newer Nexora
 * release when they join the network. PostLoginEvent fires once per proxy
 * login – not on server switches – and the notifier's cooldown prevents
 * repeats on reconnects. Uses cached data only (no network I/O).
 */
final class UpdateListener {
    private final ProxyServer proxy;
    private final Object plugin;
    private final UpdateNotifier notifier;

    UpdateListener(ProxyServer proxy, Object plugin, UpdateNotifier notifier) {
        this.proxy = proxy;
        this.plugin = plugin;
        this.notifier = notifier;
    }

    @Subscribe
    public void onPostLogin(PostLoginEvent event) {
        Player player = event.getPlayer();
        if (!notifier.shouldNotify(player.getUniqueId(), player.hasPermission(UpdateNotifier.NOTIFY_PERMISSION), Instant.now())) return;
        // Shortly after joining, so the message is not lost among the server's join messages.
        proxy.getScheduler()
                .buildTask(plugin, () -> {
                    if (player.isActive()) notifier.notificationLines().forEach(player::sendMessage);
                })
                .delay(Duration.ofSeconds(3))
                .schedule();
    }
}
