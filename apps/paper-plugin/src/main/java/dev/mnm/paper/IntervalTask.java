package dev.mnm.paper;

import java.util.function.IntSupplier;

/**
 * Runs {@code task} every {@code interval} seconds while being scheduled once
 * per second. The interval is re-read on every call, so changes made in the
 * dashboard take effect without rescheduling or a restart.
 */
final class IntervalTask implements Runnable {
    private final IntSupplier intervalSeconds;
    private final Runnable task;
    private int elapsed;

    IntervalTask(IntSupplier intervalSeconds, Runnable task) {
        this.intervalSeconds = intervalSeconds;
        this.task = task;
    }

    @Override
    public void run() {
        if (++elapsed < intervalSeconds.getAsInt()) return;
        elapsed = 0;
        task.run();
    }
}
