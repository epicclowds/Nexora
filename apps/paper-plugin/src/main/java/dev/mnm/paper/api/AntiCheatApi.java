package dev.mnm.paper.api;

import java.util.concurrent.CompletableFuture;
import org.bukkit.plugin.Plugin;

/**
 * Public API for AntiCheat plugins. Obtain it from Bukkit's services manager:
 *
 * <pre>{@code
 * AntiCheatApi api = Bukkit.getServicesManager().load(AntiCheatApi.class);
 * if (api != null) {
 *     api.report(this, AntiCheatReport.builder(player.getUniqueId(), "Speed")
 *             .violationLevel(12.5)
 *             .evidence("moved 12.3 blocks/s")
 *             .metadata("ping", 42)
 *             .build());
 * }
 * }</pre>
 *
 * Only plugins listed in {@code anticheat-integrations} (config.properties) may
 * report. The network's rules (configured in the dashboard) decide whether a
 * report is only logged or leads to a warning, kick or ban. Reports are rate
 * limited per integration.
 */
public interface AntiCheatApi {

    /**
     * Submits a report asynchronously. Never blocks the calling thread.
     *
     * @param integration the reporting plugin (must be allow-listed)
     * @param report the violation
     * @return the outcome decided by the network's rules
     */
    CompletableFuture<ReportResult> report(Plugin integration, AntiCheatReport report);

    /** Whether the given plugin is allowed to use {@link #report}. */
    boolean isAuthorized(Plugin integration);
}
