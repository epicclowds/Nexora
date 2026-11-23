package dev.mnm.plugin.punish;

import dev.mnm.plugin.Messages;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.Locale;
import java.util.Map;
import net.kyori.adventure.text.Component;

/** Player-facing texts for punishments, rendered in the configured network language. */
public final class PunishmentTexts {
    private final Messages messages;
    private final DateTimeFormatter dateTime;

    public PunishmentTexts(Messages messages) {
        this.messages = messages;
        this.dateTime = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(Locale.forLanguageTag(messages.locale()))
                .withZone(ZoneId.systemDefault());
    }

    public Messages messages() {
        return messages;
    }

    public String formatInstant(Long epochMillis) {
        return epochMillis == null ? messages.raw("time.permanent") : dateTime.format(Instant.ofEpochMilli(epochMillis));
    }

    /** Disconnect screen for a ban or blacklist. */
    public Component banScreen(CachedPunishment p) {
        String key = p.isPermanent() ? "punishment.ban.screen" : "punishment.tempban.screen";
        return messages.render(key, Map.of("reason", p.reason(), "id", p.id(), "expires", formatInstant(p.expiresAt())));
    }

    public Component kickScreen(String reason) {
        return messages.render("punishment.kick.screen", Map.of("reason", reason));
    }

    public Component muteNotice(CachedPunishment p) {
        String key = p.isPermanent() ? "punishment.mute.notice" : "punishment.tempmute.notice";
        return messages.prefixed(key, Map.of("reason", p.reason(), "expires", formatInstant(p.expiresAt())));
    }

    public Component warnNotice(String reason) {
        return messages.prefixed("punishment.warn.notice", Map.of("reason", reason));
    }

    /** Localized punishment type, e.g. TEMP_BAN → "Temporary ban". */
    public String typeName(String type) {
        return messages.raw("type." + type.toLowerCase(Locale.ROOT).replace('_', '-'));
    }

    public String stateName(String status) {
        return messages.raw("state." + status.toLowerCase(Locale.ROOT));
    }
}
