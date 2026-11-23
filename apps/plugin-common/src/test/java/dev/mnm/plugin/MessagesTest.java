package dev.mnm.plugin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;

class MessagesTest {
    private static final PlainTextComponentSerializer PLAIN = PlainTextComponentSerializer.plainText();

    @Test
    void loadsEnglishByDefaultAndFallsBackForUnknownLocales() throws Exception {
        Messages messages = Messages.load(getClass().getClassLoader(), "xx-XX");
        assertEquals("en-US", messages.locale());
        assertTrue(messages.raw("command.kick.success").contains("{player}"));
    }

    @Test
    void loadsGerman() throws Exception {
        Messages messages = Messages.load(getClass().getClassLoader(), "de-DE");
        assertEquals("de-DE", messages.locale());
        assertEquals("Ungültige Dauer \"5x\". Beispiele: 30m, 12h, 7d, 1w.", PLAIN.serialize(messages.render("error.invalid-duration", Map.of("input", "5x"))));
    }

    @Test
    void insertsVariablesAsPlainText() throws Exception {
        Messages messages = Messages.load(getClass().getClassLoader(), "en-US");
        String text = PLAIN.serialize(messages.render("command.kick.success", Map.of("player", "<red>Evil</red>")));
        assertEquals("<red>Evil</red> was kicked.", text, "player-controlled values must not be parsed as formatting");
    }

    @Test
    void appliesLanguageAndOverridesLive() throws Exception {
        Messages messages = Messages.load(getClass().getClassLoader(), "en-US");
        messages.apply("de-DE", Map.of("command.kick.success", "<green>{player} ist weg.", "not.a.key", "ignored"));
        assertEquals("de-DE", messages.locale());
        assertEquals("Steve ist weg.", PLAIN.serialize(messages.render("command.kick.success", Map.of("player", "Steve"))));
        assertEquals("not.a.key", messages.raw("not.a.key"));
        // A language without bundled file uses English plus its overrides.
        messages.apply("fr-FR", Map.of("command.kick.success", "{player} a été expulsé."));
        assertEquals("fr-FR", messages.locale());
        assertTrue(messages.raw("command.ban.success").contains("was banned"));
        messages.apply("en-US", Map.of());
        assertEquals("Steve was kicked.", PLAIN.serialize(messages.render("command.kick.success", Map.of("player", "Steve"))));
    }

    @Test
    void unknownKeysRenderAsKey() throws Exception {
        Messages messages = Messages.load(getClass().getClassLoader(), "en-US");
        assertEquals("does.not.exist", messages.raw("does.not.exist"));
        assertFalse(PLAIN.serialize(messages.prefixed("status.title", Map.of())).isEmpty());
    }
}
