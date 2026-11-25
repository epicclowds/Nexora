package dev.mnm.plugin.client;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** Brand capture per session on the proxy. */
class ClientDetectionTest {
    private final ClientDetection clients = new ClientDetection(LoggerFactory.getLogger(ClientDetectionTest.class));
    private final UUID session = UUID.randomUUID();

    @Test
    void sendsEachBrandOncePerSession() {
        assertEquals(Optional.of("NoRisk Client"), clients.brandToSend(session, "NoRisk Client"));
        // Clients resend the brand on server switches; the join may also have carried it.
        assertEquals(Optional.empty(), clients.brandToSend(session, "NoRisk Client"));
        assertTrue(clients.hasBrand(session));
        assertEquals(Optional.of("fabric"), clients.brandToSend(session, "fabric"), "a changed brand is sent");
    }

    @Test
    void aNewSessionGetsItsOwnBrandEvenWhenItRepeats() {
        // The bug fixed in 1.4.0: an identical brand in the next session was not recorded.
        assertTrue(clients.brandToSend(session, "vanilla").isPresent());
        clients.sessionClosed(session);
        UUID next = UUID.randomUUID();
        assertFalse(clients.hasBrand(next), "nothing is copied from the previous session");
        assertEquals(Optional.of("vanilla"), clients.brandToSend(next, "vanilla"));
    }

    @Test
    void ignoresMissingAndEmptyBrands() {
        assertEquals(Optional.empty(), clients.brandToSend(session, null));
        assertEquals(Optional.empty(), clients.brandToSend(session, "   "));
        assertFalse(clients.hasBrand(session));
        assertTrue(clients.brandToSend(session, "forge").isPresent());
        assertEquals(Optional.empty(), clients.brandToSend(session, ""), "an empty brand never replaces a recorded one");
    }

    @Test
    void cleansBrands() {
        assertEquals("fabric", ClientDetection.clean("  fab\u0000ric\n "));
        assertEquals(ClientDetection.MAX_BRAND_LENGTH, ClientDetection.clean("x".repeat(500)).length());
        assertNull(ClientDetection.clean("\u0001\u0002"));
    }

    @Test
    void followsTheDashboardSettings() {
        assertTrue(clients.enabled());
        assertTrue(clients.noriskEnabled());
        assertFalse(clients.debugEnabled());

        JsonObject heartbeat = new JsonObject();
        JsonObject settings = new JsonObject();
        settings.addProperty("enabled", false);
        settings.addProperty("debug", true);
        settings.addProperty("norisk", true);
        heartbeat.add("clientDetection", settings);
        clients.accept(heartbeat);
        assertFalse(clients.enabled());
        assertTrue(clients.debugEnabled());
        assertFalse(clients.noriskEnabled(), "no NoRisk checks while detection is off");
        assertEquals(Optional.empty(), clients.brandToSend(session, "vanilla"));

        clients.accept(new JsonObject()); // older backend without the field: unchanged
        assertFalse(clients.enabled());
    }

    @Test
    void reportsAnIntegrationResultOncePerSession() {
        assertTrue(clients.firstIntegrationReport(session));
        assertFalse(clients.firstIntegrationReport(session));
        clients.sessionClosed(session);
        assertTrue(clients.firstIntegrationReport(session));
    }
}
