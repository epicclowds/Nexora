package dev.mnm.plugin.punish;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonParser;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** Reason ID parsing (same rule as the backend) and the cached reason catalogue. */
class ReasonPresetsTest {
    @Test
    void parsesReasonIdsOnlyAsASingleNumberWithOptionalDuration() {
        ReasonArguments id = ReasonArguments.parse(new String[] {"1"}, true);
        assertTrue(id.isPreset());
        assertEquals(1, id.reasonId());
        assertFalse(id.override());

        ReasonArguments override = ReasonArguments.parse(new String[] {"5", "7d"}, true);
        assertEquals(5, override.reasonId());
        assertEquals(7L * 86_400, override.overrideSeconds());

        ReasonArguments permanent = ReasonArguments.parse(new String[] {"5", "permanent"}, true);
        assertTrue(permanent.permanentOverride());

        ReasonArguments typed = ReasonArguments.parse(new String[] {"1", "day", "of", "griefing"}, true);
        assertFalse(typed.isPreset(), "a number followed by words is a typed reason");
        assertEquals("1 day of griefing", typed.reason());

        ReasonArguments text = ReasonArguments.parse(new String[] {"Using", "an", "auto-clicker"}, true);
        assertEquals("Using an auto-clicker", text.reason());

        ReasonArguments freeText = ReasonArguments.parse(new String[] {"1"}, false);
        assertFalse(freeText.isPreset(), "free-text mode: numbers are text");
        assertEquals("1", freeText.reason());

        assertNull(ReasonArguments.reference("12345"));
        assertEquals(12, ReasonArguments.reference("12"));
    }

    @Test
    void catalogueFiltersByCategoryAndPermission() {
        ReasonCatalog catalog = new ReasonCatalog(null, LoggerFactory.getLogger("test"));
        assertNull(catalog.mode(), "unknown before the first fetch");
        catalog.apply(JsonParser.parseString("""
                {"mode":"HYBRID","revision":3,"presets":[
                  {"category":"BAN","numericId":1,"name":"Hacking","reason":"Hacking","durationSeconds":2592000,"permanent":false,"permission":"nexora.punishment.ban.1"},
                  {"category":"BAN","numericId":5,"name":"Severe cheating","reason":"Severe cheating","durationSeconds":null,"permanent":true,"permission":"nexora.punishment.ban.5"},
                  {"category":"MUTE","numericId":1,"name":"Spam","reason":"Spam","durationSeconds":3600,"permanent":false,"permission":"nexora.punishment.mute.1"}
                ]}""").getAsJsonObject());
        assertEquals(ReasonCatalog.Mode.HYBRID, catalog.mode());
        Set<String> granted = Set.of("nexora.punishment.ban.1", "nexora.punishment.mute.1");
        assertEquals(List.of(1), catalog.usable("BAN", granted::contains).stream().map(ReasonCatalog.Preset::numericId).toList());
        assertEquals("Spam", catalog.find("MUTE", 1).orElseThrow().name());
        assertTrue(catalog.find("BAN", 5).orElseThrow().permanent());
        assertTrue(catalog.find("KICK", 1).isEmpty());
        assertEquals("WARN", ReasonCatalog.categoryOf("WARNING"));

        catalog.apply(JsonParser.parseString("{\"mode\":\"FREE_TEXT\",\"revision\":4,\"presets\":[]}").getAsJsonObject());
        assertFalse(catalog.presetsAllowed());
        assertTrue(catalog.usable("BAN", p -> true).isEmpty());
    }
}
