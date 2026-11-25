package dev.mnm.plugin.punish;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.mnm.plugin.Messages;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** The reason list of /ban and /mute without a reason, and /nexora reasons <category> [page]. */
class ReasonHelpTest {
    private static final PlainTextComponentSerializer PLAIN = PlainTextComponentSerializer.plainText();

    private Messages messages;
    private ReasonCatalog catalog;

    @BeforeEach
    void setUp() throws Exception {
        messages = Messages.load(getClass().getClassLoader(), "en-US");
        catalog = new ReasonCatalog(null, LoggerFactory.getLogger(ReasonHelpTest.class));
    }

    private static JsonObject preset(String category, int id, String name, Long seconds, boolean permanent) {
        JsonObject p = new JsonObject();
        p.addProperty("category", category);
        p.addProperty("numericId", id);
        p.addProperty("name", name);
        p.addProperty("reason", name);
        if (seconds == null) p.add("durationSeconds", com.google.gson.JsonNull.INSTANCE);
        else p.addProperty("durationSeconds", seconds);
        p.addProperty("permanent", permanent);
        p.addProperty("permission", "nexora.punishment." + category.toLowerCase(java.util.Locale.ROOT) + "." + id);
        return p;
    }

    /** What the backend sends (GET /plugin/v1/moderation): enabled, non-archived presets only. */
    private void load(String mode, JsonObject... presets) {
        JsonObject body = new JsonObject();
        body.addProperty("mode", mode);
        body.addProperty("revision", 1);
        JsonArray array = new JsonArray();
        for (JsonObject p : presets) array.add(p);
        body.add("presets", array);
        catalog.apply(body);
    }

    private void standard(String mode) {
        load(mode,
                preset("BAN", 1, "Hacking", 30L * 86_400, false),
                preset("BAN", 2, "Griefing", 7L * 86_400, false),
                preset("BAN", 3, "Exploiting", 14L * 86_400, false),
                preset("BAN", 5, "Severe Cheating", null, true),
                preset("MUTE", 1, "Spam", 3600L, false),
                preset("MUTE", 2, "Insulting Players", 12L * 3600, false),
                preset("MUTE", 3, "Advertising", 7L * 86_400, false));
    }

    private List<String> show(String category, String command, String player, int page, Predicate<String> can) {
        List<String> out = new ArrayList<>();
        for (ReasonHelp.Line line : ReasonHelp.lines(catalog.mode(), category, command, player, catalog.usable(category, can), page, can, messages::raw)) {
            out.add(PLAIN.serialize(line.prefixed() ? messages.prefixed(line.key(), line.vars()) : messages.render(line.key(), line.vars())));
        }
        return out;
    }

    private static Predicate<String> perms(String... granted) {
        Set<String> set = Set.of(granted);
        return set::contains;
    }

    @Test
    void banWithoutArgumentsListsUsageAndBanReasonsWithDurations() {
        standard("PRESET_ONLY");
        List<String> lines = show("BAN", "ban", null, 1, perms("nexora.punishment.ban.1", "nexora.punishment.ban.2", "nexora.punishment.ban.3", "nexora.punishment.ban.5"));
        assertEquals(List.of(
                "[Nexora] Available ban reasons",
                "Usage: /ban <player> <reason-id>",
                " 1 - Hacking (30 days)",
                " 2 - Griefing (7 days)",
                " 3 - Exploiting (14 days)",
                " 5 - Severe Cheating (Permanent)"), lines);
    }

    @Test
    void muteListsOnlyMuteReasonsAndFillsInThePlayer() {
        standard("PRESET_ONLY");
        List<String> lines = show("MUTE", "mute", "Steve", 1, perms("nexora.punishment.mute.1", "nexora.punishment.mute.2", "nexora.punishment.mute.3"));
        assertEquals(List.of(
                "[Nexora] Available mute reasons",
                "Usage: /mute Steve <reason-id>",
                " 1 - Spam (1 hour)",
                " 2 - Insulting Players (12 hours)",
                " 3 - Advertising (7 days)"), lines);
    }

    @Test
    void neverRevealsReasonsWithoutPermission() {
        standard("HYBRID");
        List<String> lines = show("BAN", "ban", null, 1, perms("nexora.punishment.ban.2"));
        assertTrue(lines.contains(" 2 - Griefing (7 days)"));
        assertFalse(String.join("\n", lines).contains("Hacking"));
        assertFalse(String.join("\n", lines).contains("Severe"));

        List<String> none = show("BAN", "ban", null, 1, perms());
        assertTrue(none.contains("There are no reasons of this kind you may use."));
        assertFalse(String.join("\n", none).matches("(?s).* \\d+ - .*"), "no entries at all");
    }

    @Test
    void wildcardPermissionsResolvedByThePlatformShowEverything() {
        standard("PRESET_ONLY");
        // The platform (LuckPerms) resolves wildcards; the predicate answers per node.
        Predicate<String> wildcard = node -> node.startsWith("nexora.punishment.ban.");
        assertEquals(4, show("BAN", "ban", null, 1, wildcard).stream().filter(l -> l.matches(" \\d+ - .*")).count());
    }

    @Test
    void hybridModeExplainsTypedReasonsOnlyToAuthorisedModerators() {
        standard("HYBRID");
        List<String> authorised = show("BAN", "ban", null, 1, perms("nexora.punishment.ban.1", ReasonHelp.CUSTOM_PERMISSION));
        assertTrue(authorised.contains("You may also type your own reason: /ban <player> <reason>"));
        List<String> plain = show("BAN", "ban", null, 1, perms("nexora.punishment.ban.1"));
        assertFalse(String.join("\n", plain).contains("type your own reason"));

        load("PRESET_ONLY", preset("BAN", 1, "Hacking", 86_400L, false));
        assertFalse(String.join("\n", show("BAN", "ban", null, 1, perms("nexora.punishment.ban.1", ReasonHelp.CUSTOM_PERMISSION))).contains("type your own reason"),
                "no typed reasons in preset-only mode");
    }

    @Test
    void freeTextModeShowsOnlyTheNormalUsage() {
        standard("FREE_TEXT");
        assertEquals(List.of("[Nexora] Usage: /ban Steve <reason>"), show("BAN", "ban", "Steve", 1, perms("nexora.punishment.ban.1")));
    }

    @Test
    void beforeTheFirstSyncSaysSoInsteadOfGuessing() {
        assertNull(catalog.mode());
        List<String> lines = show("BAN", "ban", null, 1, perms());
        assertEquals("[Nexora] Usage: /ban <player> <reason-id|reason>", lines.get(0));
        assertTrue(lines.get(1).contains("not been loaded"));
    }

    @Test
    void showsTheDurationOverrideOnlyWhenAllowed() {
        standard("PRESET_ONLY");
        assertTrue(show("BAN", "ban", null, 1, perms("nexora.punishment.ban.1", ReasonHelp.DURATION_OVERRIDE_PERMISSION)).contains("Usage: /ban <player> <reason-id> [duration]"));
    }

    @Test
    void paginatesLongListsAndPointsToTheNextPage() {
        List<JsonObject> many = new ArrayList<>();
        for (int i = 1; i <= 20; i++) many.add(preset("BAN", i, "Reason " + i, 86_400L * i, false));
        load("PRESET_ONLY", many.toArray(JsonObject[]::new));
        Predicate<String> all = node -> true;

        List<String> first = show("BAN", "ban", null, 1, all);
        assertEquals(ReasonHelp.PAGE_SIZE, first.stream().filter(l -> l.matches(" \\d+ - .*")).count());
        assertTrue(first.contains("Page 1/3"));
        assertTrue(first.contains("Next page: /nexora reasons ban 2"));

        List<String> last = show("BAN", "ban", null, 3, all);
        assertEquals(4, last.stream().filter(l -> l.matches(" \\d+ - .*")).count());
        assertTrue(last.contains(" 20 - Reason 20 (20 days)"));
        assertTrue(last.contains("Page 3/3"));
        assertFalse(String.join("\n", last).contains("Next page"));

        assertTrue(show("BAN", "ban", null, 99, all).contains("Page 3/3"), "out-of-range pages are clamped");
        assertFalse(String.join("\n", show("MUTE", "mute", null, 1, all)).contains("Page"), "short lists have no pagination");
    }

    @Test
    void reflectsUpdatedPresetsWithoutRestart() {
        standard("PRESET_ONLY");
        Predicate<String> all = node -> true;
        assertTrue(show("BAN", "ban", null, 1, all).contains(" 1 - Hacking (30 days)"));
        // Reason 1 renamed, reason 2 disabled/archived (the backend no longer sends it), mode switched.
        load("HYBRID", preset("BAN", 1, "Cheating", 60L * 86_400, false), preset("BAN", 5, "Severe Cheating", null, true));
        List<String> after = show("BAN", "ban", null, 1, all);
        assertTrue(after.contains(" 1 - Cheating (60 days)"));
        assertFalse(String.join("\n", after).contains("Griefing"));
        assertTrue(after.contains("You may also type your own reason: /ban <player> <reason>"));
    }

    @Test
    void kicksAndWarningsHaveNoDuration() {
        load("PRESET_ONLY", preset("WARN", 1, "Language", null, false));
        assertTrue(show("WARN", "warn", null, 1, node -> true).contains(" 1 - Language"));
    }

    @Test
    void readableDurationsUseTheTwoLargestUnitsAndAreTranslated() throws Exception {
        assertEquals("1 day 12 hours", ReasonHelp.readable(36 * 3600, messages::raw));
        assertEquals("1 hour", ReasonHelp.readable(3600, messages::raw));
        assertEquals("45 minutes", ReasonHelp.readable(45 * 60, messages::raw));
        assertEquals("2 days", ReasonHelp.readable(2 * 86_400 + 30 * 60, messages::raw), "days and minutes are not adjacent: only days");
        Messages german = Messages.load(getClass().getClassLoader(), "de-DE");
        assertEquals("30 Tage", ReasonHelp.readable(30 * 86_400, german::raw));
        assertNotEquals(messages.raw("reasons.list.title.ban"), german.raw("reasons.list.title.ban"));
    }

    @Test
    void parsesCategoryNames() {
        assertEquals("BAN", ReasonHelp.parseCategory("bans"));
        assertEquals("WARN", ReasonHelp.parseCategory("Warning"));
        assertEquals("MUTE", ReasonHelp.parseCategory("mute"));
        assertNull(ReasonHelp.parseCategory("unban"));
    }
}
