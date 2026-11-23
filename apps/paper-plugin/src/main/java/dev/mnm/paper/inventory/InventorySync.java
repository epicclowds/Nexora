package dev.mnm.paper.inventory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.mnm.plugin.BackendClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.slf4j.Logger;

/**
 * Inventory and Ender Chest synchronisation.
 *
 * <p>Snapshots are sent on join, on quit, periodically and on request. Edits
 * from the dashboard arrive as revisions of per-slot compare-and-set changes:
 * every slot must still hold the expected item (fingerprint) or the whole
 * revision is rejected as a conflict. Validation and application happen in one
 * main-thread task, so the player cannot change the inventory in between –
 * items can neither be duplicated nor lost.
 *
 * <p>Results are reported with retries; a revision that was applied but not yet
 * acknowledged is never applied again (its result is re-sent instead).
 */
public final class InventorySync implements Listener {
    private static final int INVENTORY_SIZE = 41;
    private static final int ENDER_CHEST_SIZE = 27;

    private final Plugin plugin;
    private final BackendClient client;
    private final boolean syncInventory;
    private final boolean syncEnderChest;
    private final Logger logger;
    private final AtomicBoolean polling = new AtomicBoolean();
    /** Results not yet acknowledged by the backend (revision id → result body). */
    private final Map<String, JsonObject> unacknowledged = new ConcurrentHashMap<>();

    public InventorySync(Plugin plugin, BackendClient client, boolean syncInventory, boolean syncEnderChest, Logger logger) {
        this.plugin = plugin;
        this.client = client;
        this.syncInventory = syncInventory;
        this.syncEnderChest = syncEnderChest;
        this.logger = logger;
    }

    // ── Snapshots ─────────────────────────────────────────────────

    /** Main thread. */
    JsonObject snapshot(Player player) {
        JsonObject entry = new JsonObject();
        entry.addProperty("uuid", player.getUniqueId().toString());
        if (syncInventory) entry.add("inventory", ItemCodec.container(player.getInventory(), INVENTORY_SIZE));
        if (syncEnderChest) entry.add("enderChest", ItemCodec.container(player.getEnderChest(), ENDER_CHEST_SIZE));
        return entry;
    }

    /** Main thread: snapshots of all online players (periodic). */
    public void snapshotAll() {
        List<JsonObject> players = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) players.add(snapshot(player));
        send(players);
    }

    private void send(List<JsonObject> players) {
        for (int i = 0; i < players.size(); i += 50) {
            JsonArray chunk = new JsonArray();
            players.subList(i, Math.min(players.size(), i + 50)).forEach(chunk::add);
            JsonObject body = new JsonObject();
            body.addProperty("capturedAt", System.currentTimeMillis());
            body.add("players", chunk);
            client.post("/api/plugin/v1/inventories", body).exceptionally(error -> {
                logger.debug("Inventory snapshot upload failed: {}", error.getMessage());
                return null;
            });
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        // One tick later the inventory is fully loaded.
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (player.isOnline()) send(List.of(snapshot(player)));
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        send(List.of(snapshot(event.getPlayer())));
    }

    // ── Pending edits ─────────────────────────────────────────────

    /** Called every few seconds (any thread). */
    public void poll() {
        if (!client.hasCredentials() || !polling.compareAndSet(false, true)) return;
        // Re-send results the backend has not acknowledged yet before fetching new work.
        unacknowledged.forEach(this::report);
        client.get("/api/plugin/v1/inventories/pending").whenComplete((body, error) -> {
            polling.set(false);
            if (error != null || !plugin.isEnabled()) return;
            Bukkit.getScheduler().runTask(plugin, () -> handle(body));
        });
    }

    /** Main thread. */
    private void handle(JsonObject body) {
        List<JsonObject> requested = new ArrayList<>();
        for (JsonElement id : body.getAsJsonArray("snapshotRequests")) {
            Player player = Bukkit.getPlayer(UUID.fromString(id.getAsString()));
            if (player != null) requested.add(snapshot(player));
        }
        if (!requested.isEmpty()) send(requested);
        for (JsonElement revision : body.getAsJsonArray("revisions")) {
            JsonObject r = revision.getAsJsonObject();
            if (unacknowledged.containsKey(r.get("id").getAsString())) continue;
            apply(r);
        }
    }

    /** Main thread: validates every slot, then applies all changes or none. */
    private void apply(JsonObject revision) {
        String id = revision.get("id").getAsString();
        Player player = Bukkit.getPlayer(UUID.fromString(revision.get("playerUuid").getAsString()));
        if (player == null) return; // left meanwhile: stays pending until the next join
        boolean enderChest = "ENDER_CHEST".equals(revision.get("kind").getAsString());
        Inventory inventory = enderChest ? player.getEnderChest() : player.getInventory();
        int size = enderChest ? ENDER_CHEST_SIZE : INVENTORY_SIZE;

        List<Integer> slots = new ArrayList<>();
        List<ItemStack> targets = new ArrayList<>();
        for (JsonElement element : revision.getAsJsonArray("changes")) {
            JsonObject change = element.getAsJsonObject();
            int slot = change.get("slot").getAsInt();
            if (slot < 0 || slot >= size) {
                finish(id, "REJECTED", "Slot " + slot + " does not exist", null, player, enderChest);
                return;
            }
            String expected = change.get("before").isJsonNull() ? null : change.get("before").getAsString();
            String actual = ItemCodec.fingerprint(inventory.getItem(slot));
            if (expected == null ? actual != null : !expected.equals(actual)) {
                finish(id, "CONFLICT", "Slot " + slot + " changed in game since the edit was made", null, player, enderChest);
                return;
            }
            try {
                targets.add(change.get("after").isJsonNull() ? null : ItemCodec.decode(change.getAsJsonObject("after")));
            } catch (RuntimeException e) {
                finish(id, "REJECTED", "Slot " + slot + ": " + e.getMessage(), null, player, enderChest);
                return;
            }
            slots.add(slot);
        }

        JsonObject appliedFps = new JsonObject();
        for (int i = 0; i < slots.size(); i++) {
            inventory.setItem(slots.get(i), targets.get(i));
            appliedFps.addProperty(String.valueOf(slots.get(i)), ItemCodec.fingerprint(inventory.getItem(slots.get(i))));
        }
        player.updateInventory();
        logger.info("Applied inventory revision {} for {} ({} slot(s))", id, player.getName(), slots.size());
        finish(id, "APPLIED", null, appliedFps, player, enderChest);
    }

    private void finish(String revisionId, String status, String message, JsonObject appliedFps, Player player, boolean enderChest) {
        JsonObject result = new JsonObject();
        result.addProperty("status", status);
        if (message != null) result.addProperty("message", message.length() > 500 ? message.substring(0, 500) : message);
        if (appliedFps != null) result.add("appliedFps", appliedFps);
        result.add("snapshot", ItemCodec.container(enderChest ? player.getEnderChest() : player.getInventory(), enderChest ? ENDER_CHEST_SIZE : INVENTORY_SIZE));
        if (!"APPLIED".equals(status)) logger.warn("Inventory revision {} for {}: {} ({})", revisionId, player.getName(), status, message);
        unacknowledged.put(revisionId, result);
        report(revisionId, result);
    }

    private void report(String revisionId, JsonObject result) {
        client.post("/api/plugin/v1/inventories/revisions/" + revisionId + "/result", result)
                .thenAccept(ok -> unacknowledged.remove(revisionId))
                .exceptionally(error -> {
                    logger.debug("Reporting inventory revision {} failed, will retry: {}", revisionId, error.getMessage());
                    return null;
                });
    }
}
