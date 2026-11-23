package dev.mnm.plugin.punish;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PunishmentCacheTest {
    private static final UUID STEVE = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");
    private static final UUID ALEX = UUID.fromString("ec561538-f3fd-461d-aff5-086b22154bce");
    private static final long NOW = 1_800_000_000_000L;

    private static CachedPunishment p(String id, String type, UUID target, String ip, Long expiresAt) {
        return new CachedPunishment(id, type, target, "name", ip, "reason", "mod", NOW - 1000, expiresAt);
    }

    @Test
    void findsActiveBansAndMutesOnly() {
        PunishmentCache cache = new PunishmentCache();
        cache.replaceAll(List.of(p("1", "TEMP_BAN", STEVE, null, NOW + 60_000), p("2", "MUTE", ALEX, null, null), p("3", "KICK", ALEX, null, null)), "10");
        assertEquals(2, cache.size(), "kicks are never cached");
        assertTrue(cache.findBan(STEVE, null, NOW).isPresent());
        assertFalse(cache.findBan(STEVE, null, NOW + 120_000).isPresent(), "expired bans are not enforced");
        assertTrue(cache.findMute(ALEX, NOW).isPresent());
        assertFalse(cache.findBan(ALEX, null, NOW).isPresent());
    }

    @Test
    void blacklistAlsoMatchesTheIpAddress() {
        PunishmentCache cache = new PunishmentCache();
        cache.put(p("4", "BLACKLIST", STEVE, "203.0.113.7", null));
        UUID altAccount = UUID.randomUUID();
        assertTrue(cache.findBan(altAccount, "203.0.113.7", NOW).isPresent());
        assertFalse(cache.findBan(altAccount, "198.51.100.1", NOW).isPresent());
        cache.put(p("5", "BAN", ALEX, "198.51.100.1", null));
        assertFalse(cache.findBan(altAccount, "198.51.100.1", NOW).isPresent(), "regular bans never match by IP");
    }

    @Test
    void persistsAndRestoresForOfflineEnforcement(@TempDir Path dir) throws Exception {
        PunishmentCache cache = new PunishmentCache();
        cache.replaceAll(List.of(p("1", "BAN", STEVE, null, null)), "42");
        cache.save(dir);
        PunishmentCache restored = new PunishmentCache();
        assertTrue(restored.load(dir));
        assertEquals("42", restored.cursor());
        assertTrue(restored.findBan(STEVE, null, NOW).isPresent());
        restored.remove("1");
        assertFalse(restored.findBan(STEVE, null, NOW).isPresent());
    }

    @Test
    void parsesCommandDurations() {
        assertEquals(Duration.ofMinutes(30), Durations.parse("30m").orElseThrow());
        assertEquals(Duration.ofHours(36), Durations.parse("1d12h").orElseThrow());
        assertEquals(Duration.ofDays(14), Durations.parse("2W").orElseThrow());
        assertEquals(Duration.ofDays(30), Durations.parse("1mo").orElseThrow());
        assertTrue(Durations.parse("10s").isEmpty(), "below the minimum");
        assertTrue(Durations.parse("abc").isEmpty());
        assertTrue(Durations.parse("5x").isEmpty());
        assertTrue(Durations.parse("11y").isEmpty(), "above the maximum");
        assertEquals("1d 12h", Durations.format(Duration.ofHours(36)));
        assertEquals("30m", Durations.format(Duration.ofMinutes(30)));
    }
}
