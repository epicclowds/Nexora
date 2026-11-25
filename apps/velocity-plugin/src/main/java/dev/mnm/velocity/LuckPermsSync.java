package dev.mnm.velocity;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import dev.mnm.plugin.BackendClient;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import net.luckperms.api.LuckPerms;
import net.luckperms.api.LuckPermsProvider;
import net.luckperms.api.cacheddata.CachedMetaData;
import net.luckperms.api.cacheddata.CachedPermissionData;
import net.luckperms.api.event.group.GroupDataRecalculateEvent;
import net.luckperms.api.event.user.UserDataRecalculateEvent;
import net.luckperms.api.model.group.Group;
import net.luckperms.api.model.user.User;
import net.luckperms.api.node.Node;
import net.luckperms.api.query.QueryOptions;
import net.luckperms.api.util.Tristate;
import org.slf4j.Logger;

/**
 * Optional LuckPerms integration on the proxy (only loaded when LuckPerms is
 * installed – see {@link #available}). Sends snapshots of linked staff and
 * online players to the backend: groups, primary group, prefix and the
 * canonical Nexora permissions as LuckPerms evaluates them (inheritance,
 * negated nodes, temporary nodes) in the proxy's static context – the one
 * network-wide context for global moderation permissions; server-specific
 * contexts never grant them.
 *
 * <p>Event-driven (user/group recalculation) with a full reconciliation every
 * five minutes to recover from missed events. All LuckPerms calls are
 * asynchronous; nothing runs on the proxy's network threads.
 */
final class LuckPermsSync implements PermissionSyncBridge {
    private static final Duration FLUSH_INTERVAL = Duration.ofSeconds(2);
    private static final Duration RECONCILE_INTERVAL = Duration.ofMinutes(5);
    private static final int BATCH = 100;

    private final ProxyServer proxy;
    private final Object plugin;
    private final BackendClient client;
    private final Logger logger;
    private final LuckPerms luckPerms;
    private final Set<UUID> pending = ConcurrentHashMap.newKeySet();
    private final AtomicBoolean flushing = new AtomicBoolean();
    private final AtomicBoolean announced = new AtomicBoolean();
    private volatile List<String> tracked = List.of();
    private volatile Set<UUID> linked = Set.of();

    private LuckPermsSync(ProxyServer proxy, Object plugin, BackendClient client, Logger logger) {
        this.proxy = proxy;
        this.plugin = plugin;
        this.client = client;
        this.logger = logger;
        this.luckPerms = LuckPermsProvider.get();
    }

    /** True when the LuckPerms plugin is installed on this proxy. */
    static boolean available(ProxyServer proxy) {
        return proxy.getPluginManager().getPlugin("luckperms").isPresent();
    }

    static LuckPermsSync start(ProxyServer proxy, Object plugin, BackendClient client, Logger logger) {
        LuckPermsSync sync = new LuckPermsSync(proxy, plugin, client, logger);
        sync.luckPerms.getEventBus().subscribe(plugin, UserDataRecalculateEvent.class, e -> sync.queue(e.getUser().getUniqueId()));
        sync.luckPerms.getEventBus().subscribe(plugin, GroupDataRecalculateEvent.class, e -> sync.queueAll());
        proxy.getScheduler().buildTask(plugin, sync::flush).delay(Duration.ofSeconds(10)).repeat(FLUSH_INTERVAL).schedule();
        proxy.getScheduler().buildTask(plugin, sync::reconcile).delay(Duration.ofSeconds(15)).repeat(RECONCILE_INTERVAL).schedule();
        logger.info("LuckPerms {} detected: synchronising staff permissions and ranks with Nexora.", sync.version());
        return sync;
    }

    @Override
    public String version() {
        return luckPerms.getPluginMetadata().getVersion();
    }

    /** Players whose data the backend wants refreshed (heartbeat response). */
    @Override
    public void accept(JsonObject heartbeat) {
        if (heartbeat == null || !heartbeat.has("permissionResync")) return;
        for (JsonElement e : heartbeat.getAsJsonArray("permissionResync")) {
            try {
                pending.add(UUID.fromString(e.getAsString()));
            } catch (IllegalArgumentException ignored) {
                // not a UUID
            }
        }
    }

    void queue(UUID uuid) {
        if (linked.contains(uuid) || proxy.getPlayer(uuid).isPresent()) pending.add(uuid);
    }

    private void queueAll() {
        pending.addAll(linked);
        proxy.getAllPlayers().forEach(p -> pending.add(p.getUniqueId()));
    }

    /** Synchronises one player right away (e.g. before creating a link code). */
    @Override
    public CompletableFuture<Void> syncNow(UUID uuid) {
        return snapshots(List.of(uuid)).thenCompose(list -> send(list, false));
    }

    private void flush() {
        if (!announced.get()) {
            // Until the first exchange succeeded (e.g. the proxy registers later): fetch the tracked
            // permissions and linked accounts, then evaluate everyone.
            if (!flushing.compareAndSet(false, true)) return;
            send(List.of(), false).whenComplete((ok, error) -> {
                flushing.set(false);
                if (error == null) queueAll();
            });
            return;
        }
        if (pending.isEmpty() || !flushing.compareAndSet(false, true)) return;
        List<UUID> batch = new ArrayList<>();
        for (UUID uuid : pending) {
            if (batch.size() >= BATCH) break;
            batch.add(uuid);
        }
        batch.forEach(pending::remove);
        snapshots(batch).thenCompose(list -> send(list, false)).whenComplete((ok, error) -> {
            flushing.set(false);
            if (error != null) {
                pending.addAll(batch); // retried with the next flush
                logger.debug("LuckPerms sync failed: {}", error.getMessage());
            }
        });
    }

    /** Full reconciliation: every linked staff member and every online player. */
    private void reconcile() {
        // An empty request first refreshes the tracked permissions and linked accounts.
        send(List.of(), false).thenCompose(ignored -> {
            Set<UUID> all = new HashSet<>(linked);
            proxy.getAllPlayers().forEach(p -> all.add(p.getUniqueId()));
            List<UUID> list = new ArrayList<>(all);
            CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
            for (int i = 0; i < list.size(); i += BATCH) {
                List<UUID> part = list.subList(i, Math.min(list.size(), i + BATCH));
                chain = chain.thenCompose(v -> snapshots(part).thenCompose(s -> send(s, true)));
            }
            return chain;
        }).exceptionally(error -> {
            logger.warn("LuckPerms reconciliation failed: {}", error.getMessage());
            return null;
        });
    }

    private CompletableFuture<List<JsonObject>> snapshots(List<UUID> uuids) {
        List<CompletableFuture<JsonObject>> futures = new ArrayList<>();
        for (UUID uuid : uuids) {
            User loaded = luckPerms.getUserManager().getUser(uuid);
            CompletableFuture<User> user = loaded != null ? CompletableFuture.completedFuture(loaded) : luckPerms.getUserManager().loadUser(uuid);
            futures.add(user.thenApply(this::snapshot).exceptionally(e -> null));
        }
        return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
                .thenApply(v -> futures.stream().map(CompletableFuture::join).filter(java.util.Objects::nonNull).toList());
    }

    JsonObject snapshot(User user) {
        QueryOptions options = luckPerms.getContextManager().getStaticQueryOptions();
        CachedPermissionData permissions = user.getCachedData().getPermissionData(options);
        CachedMetaData meta = user.getCachedData().getMetaData(options);
        JsonObject s = new JsonObject();
        s.addProperty("uuid", user.getUniqueId().toString());
        if (user.getUsername() != null) s.addProperty("username", user.getUsername().length() > 16 ? user.getUsername().substring(0, 16) : user.getUsername());
        s.addProperty("primaryGroup", user.getPrimaryGroup());
        Group primary = luckPerms.getGroupManager().getGroup(user.getPrimaryGroup());
        if (primary != null) {
            if (primary.getDisplayName() != null) s.addProperty("groupDisplay", truncate(primary.getDisplayName(), 64));
            primary.getWeight().ifPresent(w -> s.addProperty("weight", w));
        }
        JsonArray groups = new JsonArray();
        user.getInheritedGroups(options).forEach(g -> groups.add(g.getName()));
        s.add("groups", groups);
        if (meta.getPrefix() != null) s.addProperty("prefix", truncate(meta.getPrefix(), 255));
        if (meta.getSuffix() != null) s.addProperty("suffix", truncate(meta.getSuffix(), 255));
        JsonObject perms = new JsonObject();
        for (String permission : tracked) {
            Tristate result = permissions.checkPermission(permission);
            if (result != Tristate.UNDEFINED) perms.addProperty(permission, result.asBoolean());
        }
        s.add("permissions", perms);
        // The earliest expiry of a temporary node: the backend treats the snapshot as stale afterwards.
        user.getNodes().stream().filter(Node::hasExpiry).map(Node::getExpiry).filter(java.util.Objects::nonNull).min(Instant::compareTo)
                .ifPresent(expiry -> s.addProperty("expiresAt", expiry.toEpochMilli()));
        return s;
    }

    private CompletableFuture<Void> send(List<JsonObject> snapshots, boolean full) {
        JsonObject body = new JsonObject();
        body.addProperty("luckPermsVersion", version());
        JsonArray list = new JsonArray();
        snapshots.forEach(list::add);
        body.add("snapshots", list);
        body.addProperty("full", full);
        return client.post("/api/plugin/v1/luckperms/sync", body).thenAccept(response -> {
            List<String> nextTracked = new ArrayList<>();
            response.getAsJsonArray("trackedPermissions").forEach(e -> nextTracked.add(e.getAsString()));
            Set<UUID> nextLinked = new HashSet<>();
            response.getAsJsonArray("linkedUuids").forEach(e -> nextLinked.add(UUID.fromString(e.getAsString())));
            boolean newPermissions = !nextTracked.equals(tracked);
            tracked = List.copyOf(nextTracked);
            linked = Set.copyOf(nextLinked);
            if (announced.compareAndSet(false, true)) {
                logger.info("LuckPerms synchronisation active: {} tracked permissions, {} linked staff accounts.", tracked.size(), linked.size());
            }
            if (newPermissions && !snapshots.isEmpty()) queueAll(); // re-evaluate with the new permission list
        });
    }

    @Override
    public void onJoin(Player player) {
        pending.add(player.getUniqueId());
    }

    private static String truncate(String value, int max) {
        return value.length() > max ? value.substring(0, max) : value;
    }
}
