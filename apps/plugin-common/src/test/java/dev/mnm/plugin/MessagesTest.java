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
    void unknownKeysRenderAsKey() throws Exception {
        Messages messages = Messages.load(getClass().getClassLoader(), "en-US");
        assertEquals("does.not.exist", messages.raw("does.not.exist"));
        assertFalse(PLAIN.serialize(messages.prefixed("status.title", Map.of())).isEmpty());
    }
}
