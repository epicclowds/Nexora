package dev.mnm.paper.stats;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.mnm.plugin.BackendClient;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.slf4j.Logger;

/**
 * Reads Minecraft's built-in per-player statistics and sends them to the
 * backend as absolute values. Collection runs on the main thread but is spread
 * over ticks ({@link #PLAYERS_PER_TICK} players each), so large servers see no
 * single expensive tick. HTTP calls are asynchronous. Values that are zero are
 * omitted (the backend treats "absent" as "not collected or zero").
 */
public final class StatisticsCollector implements Listener {
    static final int PLAYERS_PER_TICK = 4;
    private static final int PLAYERS_PER_REQUEST = 50;

    private static final List<Statistic> MOVEMENT = List.of(
            Statistic.WALK_ONE_CM, Statistic.SPRINT_ONE_CM, Statistic.CROUCH_ONE_CM, Statistic.SWIM_ONE_CM, Statistic.FLY_ONE_CM,
            Statistic.AVIATE_ONE_CM, Statistic.BOAT_ONE_CM, Statistic.MINECART_ONE_CM, Statistic.HORSE_ONE_CM, Statistic.JUMP);
    private static final List<Statistic> COMBAT = List.of(
            Statistic.PLAYER_KILLS, Statistic.MOB_KILLS, Statistic.DEATHS, Statistic.DAMAGE_DEALT, Statistic.DAMAGE_TAKEN);
    private static final List<Statistic> GENERAL = List.of(Statistic.FISH_CAUGHT, Statistic.PLAY_ONE_MINUTE);

    private final BackendClient client;
    private final ActivityTracker activity;
    private final Set<String> categories;
    private final Logger logger;
    private final List<Material> blocks;
    private final List<Material> items;
    private final List<EntityType> mobs;

    private final Deque<UUID> queue = new ArrayDeque<>();
    private final List<JsonObject> collected = new ArrayList<>();

    public StatisticsCollector(BackendClient client, ActivityTracker activity, Set<String> categories, Logger logger) {
        this.client = client;
        this.activity = activity;
        this.categories = categories;
        this.logger = logger;
        this.blocks = Arrays.stream(Material.values()).filter(m -> !m.isLegacy() && m.isBlock() && !m.isAir()).toList();
        this.items = Arrays.stream(Material.values()).filter(m -> !m.isLegacy() && m.isItem() && !m.isAir()).toList();
        this.mobs = Arrays.stream(EntityType.values()).filter(e -> e.isAlive() && e != EntityType.PLAYER && e.getKey() != null).toList();
    }

    /** Starts a new collection round (main thread). Ignored while a round is still running. */
    public void startRound() {
        if (!queue.isEmpty()) return;
        Bukkit.getOnlinePlayers().forEach(p -> queue.add(p.getUniqueId()));
    }

    /** Called every tick on the main thread: collects a few players, sends when the round is complete. */
    public void tick() {
        for (int i = 0; i < PLAYERS_PER_TICK && !queue.isEmpty(); i++) {
            Player player = Bukkit.getPlayer(queue.poll());
            if (player != null && player.isOnline()) collected.add(snapshot(player));
        }
        if (queue.isEmpty() && !collected.isEmpty()) {
            send(new ArrayList<>(collected));
            collected.clear();
        }
    }

    /** Final values when a player leaves this server (main thread). */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        send(List.of(snapshot(event.getPlayer())));
    }

    JsonObject snapshot(Player player) {
        activity.flush(player);
        JsonObject stats = new JsonObject();
        if (categories.contains("movement")) MOVEMENT.forEach(s -> put(stats, "custom:" + s.getKey(), player.getStatistic(s)));
        if (categories.contains("combat")) {
            COMBAT.forEach(s -> put(stats, "custom:" + s.getKey(), player.getStatistic(s)));
            for (EntityType mob : mobs) put(stats, "killed:" + mob.getKey(), safe(() -> player.getStatistic(Statistic.KILL_ENTITY, mob)));
        }
        if (categories.contains("blocks")) {
            long mined = 0;
            long placed = 0;
            for (Material block : blocks) {
                int m = safe(() -> player.getStatistic(Statistic.MINE_BLOCK, block));
                mined += m;
                put(stats, "mined:" + block.getKey(), m);
                if (block.isItem()) {
                    // Placing a block counts as "using" its item.
                    int p = safe(() -> player.getStatistic(Statistic.USE_ITEM, block));
                    placed += p;
                    put(stats, "placed:" + block.getKey(), p);
                }
            }
            put(stats, "mnm:blocks_mined", mined);
            put(stats, "mnm:blocks_placed", placed);
        }
        if (categories.contains("general")) {
            GENERAL.forEach(s -> put(stats, "custom:" + s.getKey(), player.getStatistic(s)));
            long crafted = 0;
            long used = 0;
            for (Material item : items) {
                crafted += safe(() -> player.getStatistic(Statistic.CRAFT_ITEM, item));
                used += safe(() -> player.getStatistic(Statistic.USE_ITEM, item));
            }
            put(stats, "mnm:items_crafted", crafted);
            put(stats, "mnm:items_used", used);
            put(stats, "mnm:active_time", activity.activeSeconds(player));
            put(stats, "mnm:afk_time", activity.afkSeconds(player));
            put(stats, "mnm:chat_messages", activity.chatMessages(player));
            put(stats, "mnm:xp_gained", activity.xpGained(player));
        }
        JsonObject entry = new JsonObject();
        entry.addProperty("uuid", player.getUniqueId().toString());
        entry.add("stats", stats);
        return entry;
    }

    private void send(List<JsonObject> players) {
        long capturedAt = System.currentTimeMillis();
        for (int i = 0; i < players.size(); i += PLAYERS_PER_REQUEST) {
            JsonArray chunk = new JsonArray();
            players.subList(i, Math.min(players.size(), i + PLAYERS_PER_REQUEST)).forEach(chunk::add);
            JsonObject body = new JsonObject();
            body.addProperty("capturedAt", capturedAt);
            body.add("players", chunk);
            // Absolute values: a failed upload is simply superseded by the next round.
            client.post("/api/plugin/v1/statistics", body).exceptionally(error -> {
                logger.debug("Statistics upload failed: {}", error.getMessage());
                return null;
            });
        }
    }

    private static void put(JsonObject stats, String key, long value) {
        if (value > 0) stats.addProperty(key, value);
    }

    /** Some statistic/material combinations are rejected by the server (e.g. technical blocks). */
    private static int safe(java.util.function.IntSupplier read) {
        try {
            return read.getAsInt();
        } catch (IllegalArgumentException e) {
            return 0;
        }
    }
}
