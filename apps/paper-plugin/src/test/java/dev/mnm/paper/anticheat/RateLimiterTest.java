package dev.mnm.paper.anticheat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mnm.paper.api.AntiCheatReport;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RateLimiterTest {

    @Test
    void limitsEachIntegrationIndependently() {
        AntiCheatBridge.RateLimiter limiter = new AntiCheatBridge.RateLimiter(2, 60_000);
        assertTrue(limiter.tryAcquire("grim"));
        assertTrue(limiter.tryAcquire("grim"));
        assertFalse(limiter.tryAcquire("grim"), "third report in the window is dropped");
        assertTrue(limiter.tryAcquire("vulcan"), "other integrations are unaffected");
    }

    @Test
    void reopensAfterTheWindow() throws InterruptedException {
        AntiCheatBridge.RateLimiter limiter = new AntiCheatBridge.RateLimiter(1, 50);
        assertTrue(limiter.tryAcquire("grim"));
        assertFalse(limiter.tryAcquire("grim"));
        Thread.sleep(60);
        assertTrue(limiter.tryAcquire("grim"));
    }

    @Test
    void reportBuilderRejectsUnsupportedMetadata() {
        AntiCheatReport.Builder builder = AntiCheatReport.builder(UUID.randomUUID(), "Speed").metadata("ping", 42).metadata("lagging", false);
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> builder.metadata("location", new Object()));
        org.junit.jupiter.api.Assertions.assertEquals(2, builder.build().metadata().size());
    }
}
