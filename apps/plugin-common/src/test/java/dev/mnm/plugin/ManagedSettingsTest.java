package dev.mnm.plugin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;

class ManagedSettingsTest {
    private static final String REMOTE = """
            {"revision":3,"language":"de-DE","statisticsEnabled":false,"statisticsCategories":["combat","flying"],
             "statisticsIntervalSeconds":5,"inventorySync":null,"enderChestSync":false,"inventorySyncIntervalSeconds":120,
             "messages":{"de-DE":{"command.kick.success":"{player} ist weg."}}}""";

    private static PluginConfig config(boolean managed) {
        Properties p = new Properties();
        p.setProperty("backend-url", "http://x.test");
        p.setProperty("managed-settings", String.valueOf(managed));
        p.setProperty("statistics-interval-seconds", "600");
        return PluginConfig.fromProperties(p);
    }

    @Test
    void remoteValuesOverrideLocalOnesAndNullKeepsLocal(@TempDir Path dir) {
        ManagedSettings settings = new ManagedSettings(config(true), dir, LoggerFactory.getLogger("test"));
        assertEquals(-1, settings.revision());
        assertEquals("en-US", settings.language());
        AtomicInteger changes = new AtomicInteger();
        settings.onChange(changes::incrementAndGet);

        settings.apply(JsonParser.parseString(REMOTE).getAsJsonObject());
        assertEquals(3, settings.revision());
        assertEquals("de-DE", settings.language());
        assertFalse(settings.statisticsEnabled());
        assertEquals(Set.of("combat"), settings.statisticsCategories());
        assertEquals(60, settings.statisticsIntervalSeconds(), "clamped to the allowed range");
        assertTrue(settings.inventorySync(), "null keeps the local value");
        assertFalse(settings.enderChestSync());
        assertEquals(120, settings.inventorySyncIntervalSeconds());
        assertEquals(Map.of("command.kick.success", "{player} ist weg."), settings.messageOverrides("de-DE"));
        assertEquals(Map.of(), settings.messageOverrides("en-US"));
        assertEquals(1, changes.get());

        // Same revision again: nothing happens.
        settings.apply(JsonParser.parseString(REMOTE).getAsJsonObject());
        assertEquals(1, changes.get());
    }

    @Test
    void cachesTheLastDocumentForTheNextStart(@TempDir Path dir) {
        new ManagedSettings(config(true), dir, LoggerFactory.getLogger("test")).apply(JsonParser.parseString(REMOTE).getAsJsonObject());
        assertTrue(Files.exists(dir.resolve(ManagedSettings.CACHE_FILE)));
        ManagedSettings restarted = new ManagedSettings(config(true), dir, LoggerFactory.getLogger("test"));
        assertEquals(3, restarted.revision());
        assertEquals("de-DE", restarted.language());
    }

    @Test
    void ignoresRemoteValuesWhenDisabledLocally(@TempDir Path dir) {
        ManagedSettings settings = new ManagedSettings(config(false), dir, LoggerFactory.getLogger("test"));
        settings.apply(JsonParser.parseString(REMOTE).getAsJsonObject());
        assertEquals("en-US", settings.language());
        assertTrue(settings.statisticsEnabled());
        assertEquals(600, settings.statisticsIntervalSeconds());
        assertFalse(Files.exists(dir.resolve(ManagedSettings.CACHE_FILE)));
    }
}
