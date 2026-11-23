package dev.mnm.plugin;

import com.google.gson.JsonObject;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Bounded, ordered in-memory buffer of player events. Events stay queued until
 * the backend acknowledges them, so short outages lose nothing. When the buffer
 * is full the oldest events are dropped and {@link #consumeOverflow()} reports
 * it, so the caller can repair state with a full sync.
 */
public final class EventQueue {
    private final int capacity;
    private final Deque<JsonObject> events = new ArrayDeque<>();
    private boolean overflowed;
    private long dropped;

    public EventQueue(int capacity) {
        if (capacity < 1) throw new IllegalArgumentException("capacity must be positive");
        this.capacity = capacity;
    }

    public synchronized void add(JsonObject event) {
        if (events.size() >= capacity) {
            events.pollFirst();
            overflowed = true;
            dropped++;
        }
        events.addLast(event);
    }

    /** Oldest events first, without removing them. */
    public synchronized List<JsonObject> peek(int max) {
        List<JsonObject> batch = new ArrayList<>(Math.min(max, events.size()));
        for (JsonObject event : events) {
            if (batch.size() >= max) break;
            batch.add(event);
        }
        return batch;
    }

    /**
     * Removes the given acknowledged events. Compares by identity so events
     * dropped by overflow in the meantime are handled correctly.
     */
    public synchronized void acknowledge(List<JsonObject> sent) {
        for (JsonObject event : sent) {
            if (!events.isEmpty() && events.peekFirst() == event) events.pollFirst();
            else events.removeIf(e -> e == event);
        }
    }

    public synchronized int size() {
        return events.size();
    }

    public synchronized long droppedTotal() {
        return dropped;
    }

    /** True once after events were dropped. */
    public synchronized boolean consumeOverflow() {
        boolean value = overflowed;
        overflowed = false;
        return value;
    }
}
