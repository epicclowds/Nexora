package dev.mnm.plugin;

import com.google.gson.JsonObject;
import java.lang.management.ManagementFactory;

/** JVM memory and CPU figures for heartbeats. Values that the JVM cannot provide are omitted, never guessed. */
public final class ProcessMetrics {
    private ProcessMetrics() {}

    public static void addTo(JsonObject body) {
        Runtime runtime = Runtime.getRuntime();
        body.addProperty("memoryUsedBytes", runtime.totalMemory() - runtime.freeMemory());
        body.addProperty("memoryMaxBytes", runtime.maxMemory());
        if (ManagementFactory.getOperatingSystemMXBean() instanceof com.sun.management.OperatingSystemMXBean os) {
            double load = os.getProcessCpuLoad();
            if (load >= 0 && load <= 1) body.addProperty("cpuLoad", load);
        }
    }
}
