package dev.mnm.plugin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;

/** In-game update notifications: permission, cooldown, settings and cached data handling. */
class UpdateNotifierTest {
    private static final UUID STAFF = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");
    private static final Instant NOW = Instant.parse("2026-11-25T12:00:00Z");

    private static JsonObject heartbeat(boolean available, boolean notify, String url) {
        JsonObject update = new JsonObject();
        update.addProperty("latestVersion", "1.2.0");
        update.addProperty("installedVersion", "1.1.0");
        update.addProperty("updateAvailable", available);
        update.addProperty("releaseUrl", url);
        update.addProperty("checkedAt", "2026-11-25T09:00:00.000Z");
        update.addProperty("notify", notify);
        update.addProperty("cooldownMinutes", 60);
        JsonObject response = new JsonObject();
        response.addProperty("serverTime", 0);
        response.add("update", update);
        return response;
    }

    private static Messages messages() throws Exception {
        return Messages.load(UpdateNotifierTest.class.getClassLoader(), "en-US");
    }

    private static String plain(List<Component> lines) {
        return lines.stream().map(PlainTextComponentSerializer.plainText()::serialize).collect(Collectors.joining("\n"));
    }

    @Test
    void notifiesOnlyPermittedStaffOncePerCooldown() throws Exception {
        UpdateNotifier notifier = new UpdateNotifier(messages(), "1.1.0", "auto", true);
        notifier.accept(heartbeat(true, true, "https://github.com/epicclowds/Nexora/releases/tag/v1.2.0"));
        assertFalse(notifier.shouldNotify(STAFF, false, NOW), "players without networkmanager.update.notify are never notified");
        assertTrue(notifier.shouldNotify(STAFF, true, NOW));
        assertFalse(notifier.shouldNotify(STAFF, true, NOW.plus(Duration.ofMinutes(5))), "reconnect / server switch within the cooldown");
        assertTrue(notifier.shouldNotify(STAFF, true, NOW.plus(Duration.ofMinutes(61))), "again after the cooldown");

        String text = plain(notifier.notificationLines());
        assertTrue(text.contains("A new Nexora update is available!"), text);
        assertTrue(text.contains("Current version: 1.1.0"), text);
        assertTrue(text.contains("Latest version: 1.2.0"), text);
        Component download = notifier.notificationLines().get(3);
        assertEquals(ClickEvent.Action.OPEN_URL, download.clickEvent().action());
    }

    @Test
    void respectsSettingsAndUpToDateInstallations() throws Exception {
        UpdateNotifier paperAuto = new UpdateNotifier(messages(), "1.1.0", "auto", false);
        paperAuto.accept(heartbeat(true, true, "https://example.com/r"));
        assertFalse(paperAuto.shouldNotify(STAFF, true, NOW), "Paper: off by default, the proxy notifies");

        UpdateNotifier paperOn = new UpdateNotifier(messages(), "1.1.0", "true", false);
        paperOn.accept(heartbeat(true, true, "https://example.com/r"));
        assertTrue(paperOn.shouldNotify(STAFF, true, NOW));

        UpdateNotifier off = new UpdateNotifier(messages(), "1.1.0", "false", true);
        off.accept(heartbeat(true, true, "https://example.com/r"));
        assertFalse(off.shouldNotify(STAFF, true, NOW));

        UpdateNotifier dashboardOff = new UpdateNotifier(messages(), "1.1.0", "auto", true);
        dashboardOff.accept(heartbeat(true, false, "https://example.com/r"));
        assertFalse(dashboardOff.shouldNotify(STAFF, true, NOW), "minecraft notifications disabled in the dashboard");

        UpdateNotifier current = new UpdateNotifier(messages(), "1.2.0", "auto", true);
        current.accept(heartbeat(false, true, "https://example.com/r"));
        assertFalse(current.shouldNotify(STAFF, true, NOW));
        assertTrue(plain(current.infoLines(NOW)).contains("Status: Up to date"));
    }

    @Test
    void handlesMissingOrUnsafeData() throws Exception {
        UpdateNotifier notifier = new UpdateNotifier(messages(), "1.1.0", "auto", true);
        assertTrue(plain(notifier.infoLines(NOW)).contains("No update information yet"), "before the first heartbeat");
        assertFalse(notifier.shouldNotify(STAFF, true, NOW));

        notifier.accept(heartbeat(true, true, "javascript:alert(1)"));
        assertNotNull(notifier.info());
        assertNull(notifier.info().releaseUrl(), "only https links are shown");
        String info = plain(notifier.infoLines(NOW));
        assertTrue(info.contains("Installed version: 1.1.0"), info);
        assertTrue(info.contains("Status: Update available"), info);
        assertTrue(info.contains("Last checked: 3h ago"), info);
        assertFalse(info.contains("javascript"), info);

        JsonObject withoutField = new JsonObject();
        withoutField.addProperty("serverTime", 1);
        notifier.accept(withoutField);
        assertNotNull(notifier.info(), "an older backend without the field keeps the last known data");

        JsonObject disabled = new JsonObject();
        disabled.add("update", JsonNull.INSTANCE);
        notifier.accept(disabled);
        assertNull(notifier.info());
        assertTrue(plain(notifier.infoLines(NOW)).contains("not available"));
    }
}
