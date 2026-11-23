package dev.mnm.paper;

import dev.mnm.plugin.punish.PunishmentCache;
import dev.mnm.plugin.punish.PunishmentTexts;
import io.papermc.paper.event.player.AsyncChatEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Enforces network mutes on the backend server. Chat is blocked here rather
 * than on the proxy because Velocity cannot cancel signed chat messages.
 * Reads only the thread-safe local cache, so it is safe on async chat threads.
 */
final class ChatMuteListener implements Listener {
    private final PunishmentCache cache;
    private final PunishmentTexts texts;

    ChatMuteListener(PunishmentCache cache, PunishmentTexts texts) {
        this.cache = cache;
        this.texts = texts;
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        cache.findMute(event.getPlayer().getUniqueId(), System.currentTimeMillis()).ifPresent(mute -> {
            event.setCancelled(true);
            event.getPlayer().sendMessage(texts.muteNotice(mute));
        });
    }
}
