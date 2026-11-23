package dev.mnm.plugin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PluginConfigTest {

    @Test
    void createsDefaultConfigOnFirstStart(@TempDir Path dir) throws Exception {
        PluginConfig config = PluginConfig.loadOrCreate(dir, getClass().getClassLoader());
        assertTrue(Files.exists(dir.resolve(PluginConfig.FILE_NAME)));
        assertEquals("http://localhost:3000", config.backendUrl().toString());
        assertEquals("en-US", config.language());
        assertEquals(15, config.heartbeatIntervalSeconds());
        assertTrue(config.collectIpAddresses());
    }

    @Test
    void clampsIntervalsAndNormalisesUrl() {
        Properties p = new Properties();
        p.setProperty("backend-url", "https://admin.example.net/");
        p.setProperty("heartbeat-interval-seconds", "1");
        p.setProperty("sync-interval-seconds", "not-a-number");
        PluginConfig config = PluginConfig.fromProperties(p);
        assertEquals("https://admin.example.net", config.backendUrl().toString());
        assertEquals(5, config.heartbeatIntervalSeconds());
        assertEquals(60, config.syncIntervalSeconds());
    }

    @Test
    void parsesStatisticCategoriesAndIgnoresUnknownOnes() {
        assertEquals(java.util.Set.of("combat", "movement"), PluginConfig.categories(" Movement, combat ,flying"));
        Properties p = new Properties();
        p.setProperty("backend-url", "http://x.test");
        PluginConfig config = PluginConfig.fromProperties(p);
        assertEquals(PluginConfig.STATISTIC_CATEGORIES, config.statisticsCategories());
        assertEquals(300, config.statisticsIntervalSeconds());
        assertEquals(300, config.afkTimeoutSeconds());
    }

    @Test
    void rejectsInvalidBackendUrls() {
        assertThrows(IllegalArgumentException.class, () -> PluginConfig.parseBackendUrl(""));
        assertThrows(IllegalArgumentException.class, () -> PluginConfig.parseBackendUrl("ftp://example.net"));
        assertThrows(IllegalArgumentException.class, () -> PluginConfig.parseBackendUrl("https://example.net/admin"));
    }

    @Test
    void credentialsRoundTrip(@TempDir Path dir) throws Exception {
        new Credentials("mnm_key_1", "mnm_sk_2", "srv", "lobby").save(dir);
        Credentials loaded = Credentials.load(dir).orElseThrow();
        assertEquals("mnm_key_1", loaded.keyId());
        assertEquals("mnm_sk_2", loaded.secret());
        assertEquals("lobby", loaded.serverName());
        assertTrue(!loaded.toString().contains("mnm_sk_2"), "toString must not leak the secret");
    }
}
