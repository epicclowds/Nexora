package dev.mnm.velocity;

import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.mnm.plugin.punish.CachedPunishment;
import dev.mnm.plugin.punish.PunishmentCache;
import dev.mnm.plugin.punish.PunishmentFeed;
import dev.mnm.plugin.punish.PunishmentTexts;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;

/**
 * Enforces punishments on the proxy: denies banned/blacklisted logins from the
 * local cache (no network round-trip on login) and applies new punishments to
 * online players as soon as they appear in the feed or a command succeeds.
 */
final class Enforcer implements PunishmentFeed.Listener {
    static final String NOTIFY_PERMISSION = "networkmanager.notify";

    private final ProxyServer proxy;
    private final PunishmentCache cache;
    private final PunishmentTexts texts;
    private final Logger logger;
    /** Punishments already acted on (command path and feed path must not double-apply). */
    private final Set<String> handled = ConcurrentHashMap.newKeySet();

    Enforcer(ProxyServer proxy, PunishmentCache cache, PunishmentTexts texts, Logger logger) {
        this.proxy = proxy;
        this.cache = cache;
        this.texts = texts;
        this.logger = logger;
    }

    @Subscribe(priority = Short.MAX_VALUE)
    public void onLogin(LoginEvent event) {
        Player player = event.getPlayer();
        InetSocketAddress remote = player.getRemoteAddress();
        String ip = remote == null || remote.getAddress() == null ? null : remote.getAddress().getHostAddress();
        cache.findBan(player.getUniqueId(), ip, System.currentTimeMillis()).ifPresent(ban -> {
            event.setResult(ResultedEvent.ComponentResult.denied(texts.banScreen(ban)));
            logger.info("Denied login of {} ({}): {} {}", player.getUsername(), player.getUniqueId(), ban.type(), ban.id());
        });
    }

    @Override
    public void created(CachedPunishment p) {
        apply(p);
    }

    /** Applies a punishment to online players once and notifies staff. */
    void apply(CachedPunishment p) {
        if (!handled.add(p.id())) return;
        if (handled.size() > 10_000) handled.clear();

        Optional<Player> target = proxy.getPlayer(p.targetUuid());
        switch (p.type()) {
            case "BAN", "TEMP_BAN" -> target.ifPresent(player -> player.disconnect(texts.banScreen(p)));
            case "BLACKLIST" -> proxy.getAllPlayers().stream()
                    .filter(player -> player.getUniqueId().equals(p.targetUuid()) || (p.targetIp() != null && p.targetIp().equals(ipOf(player))))
                    .forEach(player -> player.disconnect(texts.banScreen(p)));
            case "KICK" -> target.ifPresent(player -> player.disconnect(texts.kickScreen(p.reason())));
            case "WARNING" -> target.ifPresent(player -> player.sendMessage(texts.warnNotice(p.reason())));
            case "MUTE", "TEMP_MUTE" -> target.ifPresent(player -> player.sendMessage(texts.muteNotice(p)));
            default -> {
                return;
            }
        }
        var notice = texts.messages().render("notify.staff.punishment", Map.of(
                "issuer", String.valueOf(p.issuerName()),
                "type", texts.typeName(p.type()),
                "player", String.valueOf(p.targetName()),
                "reason", p.reason()));
        proxy.getAllPlayers().stream().filter(player -> player.hasPermission(NOTIFY_PERMISSION)).forEach(player -> player.sendMessage(notice));
        logger.info("{} issued {} to {}: {}", p.issuerName(), p.type(), p.targetName(), p.reason());
    }

    private static String ipOf(Player player) {
        InetSocketAddress remote = player.getRemoteAddress();
        return remote == null || remote.getAddress() == null ? null : remote.getAddress().getHostAddress();
    }
}
