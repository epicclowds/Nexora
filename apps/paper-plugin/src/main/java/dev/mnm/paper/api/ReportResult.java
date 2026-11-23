package dev.mnm.paper.api;

/**
 * Outcome of a report.
 *
 * @param outcome one of {@code WARNING}, {@code KICK}, {@code TEMP_BAN}, {@code BAN} (a punishment was issued),
 *     {@code LOGGED}, {@code DISABLED}, {@code SKIPPED_THRESHOLD}, {@code SKIPPED_COOLDOWN},
 *     {@code SKIPPED_RATE_LIMIT}, {@code SKIPPED_DUPLICATE}, {@code SKIPPED_OFFLINE} (no punishment)
 * @param punishmentId the created punishment, or {@code null}
 */
public record ReportResult(String outcome, String punishmentId) {

    public boolean punished() {
        return punishmentId != null;
    }
}
