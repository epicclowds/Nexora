package dev.mnm.plugin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.util.List;
import org.junit.jupiter.api.Test;

class EventQueueTest {
    private static JsonObject event(int n) {
        JsonObject o = new JsonObject();
        o.addProperty("n", n);
        return o;
    }

    @Test
    void keepsOrderAndOnlyRemovesAcknowledgedEvents() {
        EventQueue queue = new EventQueue(10);
        for (int i = 0; i < 5; i++) queue.add(event(i));
        List<JsonObject> batch = queue.peek(3);
        assertEquals(3, batch.size());
        assertEquals(5, queue.size(), "peek must not remove");
        queue.acknowledge(batch);
        assertEquals(2, queue.size());
        assertEquals(3, queue.peek(1).get(0).get("n").getAsInt());
    }

    @Test
    void dropsOldestWhenFullAndReportsOverflowOnce() {
        EventQueue queue = new EventQueue(3);
        for (int i = 0; i < 5; i++) queue.add(event(i));
        assertEquals(3, queue.size());
        assertEquals(2, queue.peek(1).get(0).get("n").getAsInt());
        assertEquals(2, queue.droppedTotal());
        assertTrue(queue.consumeOverflow());
        assertFalse(queue.consumeOverflow());
    }

    @Test
    void acknowledgeToleratesEventsDroppedInFlight() {
        EventQueue queue = new EventQueue(2);
        JsonObject first = event(1);
        queue.add(first);
        queue.add(event(2));
        List<JsonObject> batch = queue.peek(2);
        JsonObject third = event(3);
        queue.add(third); // overflow drops "first" while the batch is in flight
        queue.acknowledge(batch);
        assertEquals(1, queue.size());
        assertSame(third, queue.peek(1).get(0));
    }
}
