package dev.mnm.paper.stats;

import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerExpChangeEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * Tracks values Minecraft does not record itself: active vs. AFK time, chat
 * messages and experience gained. Counters accumulate in memory (thread-safe,
 * chat is async) and are flushed into the player's PersistentDataContainer on
 * the main thread, so they survive restarts like vanilla statistics.
 */
public final class ActivityTracker implements Listener {
    private final NamespacedKey activeKey;
    private final NamespacedKey afkKey;
    private final NamespacedKey chatKey;
    private final NamespacedKey xpKey;
    private final long afkTimeoutMillis;

    private final Map<UUID, Long> lastActivity = new ConcurrentHashMap<>();
    private final Map<UUID, Pending> pending = new ConcurrentHashMap<>();

    private static final class Pending {
        final LongAdder active = new LongAdder();
        final LongAdder afk = new LongAdder();
        final LongAdder chat = new LongAdder();
        final LongAdder xp = new LongAdder();
    }

    public ActivityTracker(Plugin plugin, int afkTimeoutSeconds) {
        this.activeKey = new NamespacedKey(plugin, "active_time");
        this.afkKey = new NamespacedKey(plugin, "afk_time");
        this.chatKey = new NamespacedKey(plugin, "chat_messages");
        this.xpKey = new NamespacedKey(plugin, "xp_gained");
        this.afkTimeoutMillis = afkTimeoutSeconds * 1000L;
    }

    /** Called once per second on the main thread: adds one second of active or AFK time per online player. */
    public void tick() {
        long now = System.currentTimeMillis();
        for (Player player : Bukkit.getOnlinePlayers()) {
            long last = lastActivity.computeIfAbsent(player.getUniqueId(), id -> now);
            Pending p = pending(player.getUniqueId());
            if (now - last > afkTimeoutMillis) p.afk.increment();
            else p.active.increment();
        }
    }

    /** Main thread: moves pending counters into the player's persistent data. */
    public void flush(Player player) {
        Pending p = pending.remove(player.getUniqueId());
        if (p == null) return;
        PersistentDataContainer pdc = player.getPersistentDataContainer();
        add(pdc, activeKey, p.active.sum());
        add(pdc, afkKey, p.afk.sum());
        add(pdc, chatKey, p.chat.sum());
        add(pdc, xpKey, p.xp.sum());
    }

    public long activeSeconds(Player player) {
        return get(player.getPersistentDataContainer(), activeKey);
    }

    public long afkSeconds(Player player) {
        return get(player.getPersistentDataContainer(), afkKey);
    }

    public long chatMessages(Player player) {
        return get(player.getPersistentDataContainer(), chatKey);
    }

    public long xpGained(Player player) {
        return get(player.getPersistentDataContainer(), xpKey);
    }

    private Pending pending(UUID id) {
        return pending.computeIfAbsent(id, k -> new Pending());
    }

    private void touch(Player player) {
        lastActivity.put(player.getUniqueId(), System.currentTimeMillis());
    }

    private static void add(PersistentDataContainer pdc, NamespacedKey key, long delta) {
        if (delta > 0) pdc.set(key, PersistentDataType.LONG, get(pdc, key) + delta);
    }

    private static long get(PersistentDataContainer pdc, NamespacedKey key) {
        Long value = pdc.get(key, PersistentDataType.LONG);
        return value == null ? 0 : value;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        touch(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        Location from = event.getFrom();
        Location to = event.getTo();
        // Head rotation or walking counts as activity; being pushed by water alone does not change yaw/pitch.
        if (from.getYaw() != to.getYaw() || from.getPitch() != to.getPitch() || from.distanceSquared(to) > 0.01) touch(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        touch(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        touch(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        touch(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        touch(event.getPlayer());
    }

    /** Async event: only thread-safe structures are touched. Muted (cancelled) messages are not counted. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        touch(event.getPlayer());
        pending(event.getPlayer().getUniqueId()).chat.increment();
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onExp(PlayerExpChangeEvent event) {
        if (event.getAmount() > 0) pending(event.getPlayer().getUniqueId()).xp.add(event.getAmount());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        lastActivity.remove(event.getPlayer().getUniqueId());
    }
}
