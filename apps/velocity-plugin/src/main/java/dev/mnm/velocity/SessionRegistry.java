package dev.mnm.velocity;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Maps connected players to the session key sent to the backend. The key makes
 * join/leave events idempotent and lets the backend match a sync to sessions.
 */
final class SessionRegistry {
    private final Map<UUID, UUID> sessions = new ConcurrentHashMap<>();

    UUID open(UUID player) {
        UUID key = UUID.randomUUID();
        sessions.put(player, key);
        return key;
    }

    Optional<UUID> get(UUID player) {
        return Optional.ofNullable(sessions.get(player));
    }

    Optional<UUID> close(UUID player) {
        return Optional.ofNullable(sessions.remove(player));
    }
}
