package dev.mnm.plugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/**
 * Translated plugin messages from {@code messages/<locale>.yml} (maintained in
 * packages/translations/minecraft). Missing keys fall back to en-US. Variables
 * use {@code {name}} and are inserted as plain text, so player-controlled values
 * cannot inject formatting.
 */
public final class Messages {
    public static final String DEFAULT_LOCALE = "en-US";
    private static final Pattern VARIABLE = Pattern.compile("\\{([a-zA-Z][a-zA-Z0-9_-]*)}");

    private final ClassLoader resources;
    /** Swapped atomically when the dashboard changes the language or message overrides. */
    private volatile State state;

    private record State(String locale, Map<String, String> messages) {}

    private Messages(ClassLoader resources, State state) {
        this.resources = resources;
        this.state = state;
    }

    public static Messages load(ClassLoader resources, String locale) throws IOException {
        return new Messages(resources, build(resources, locale, Map.of()));
    }

    /**
     * Switches language and applies message overrides from the dashboard.
     * Order: en-US, bundled catalogue of {@code locale}, overrides. Unknown keys
     * are ignored; a locale without bundled file or overrides falls back to en-US.
     */
    public void apply(String locale, Map<String, String> overrides) throws IOException {
        state = build(resources, locale, overrides);
    }

    private static State build(ClassLoader resources, String locale, Map<String, String> overrides) throws IOException {
        Map<String, String> base = read(resources, DEFAULT_LOCALE);
        Map<String, String> merged = new HashMap<>(base);
        String effective = DEFAULT_LOCALE;
        if (!DEFAULT_LOCALE.equals(locale)) {
            Map<String, String> localized = read(resources, locale);
            if (!localized.isEmpty()) {
                merged.putAll(localized);
                effective = locale;
            }
        }
        boolean overridden = false;
        for (Map.Entry<String, String> e : overrides.entrySet()) {
            if (base.containsKey(e.getKey()) && e.getValue() != null) {
                merged.put(e.getKey(), e.getValue());
                overridden = true;
            }
        }
        if (overridden && locale.matches("[a-z]{2,3}-[A-Z]{2}")) effective = locale;
        return new State(effective, Map.copyOf(merged));
    }

    static Map<String, String> read(ClassLoader resources, String locale) throws IOException {
        if (!locale.matches("[a-z]{2,3}-[A-Z]{2}")) return Map.of();
        try (InputStream in = resources.getResourceAsStream("messages/" + locale + ".yml")) {
            if (in == null) return Map.of();
            try (Reader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
                Object root = new Yaml(new SafeConstructor(new LoaderOptions())).load(reader);
                Map<String, String> out = new HashMap<>();
                if (root instanceof Map<?, ?> map) {
                    map.forEach((k, v) -> {
                        if (k != null && v != null) out.put(k.toString(), v.toString());
                    });
                }
                return out;
            }
        }
    }

    public String locale() {
        return state.locale();
    }

    /** Raw MiniMessage template, or the key itself when unknown. */
    public String raw(String key) {
        return state.messages().getOrDefault(key, key);
    }

    /** Renders a message with the network prefix. */
    public Component prefixed(String key, Map<String, String> variables) {
        return render("prefix", Map.of()).append(render(key, variables));
    }

    public Component render(String key, Map<String, String> variables) {
        Matcher matcher = VARIABLE.matcher(raw(key));
        StringBuilder template = new StringBuilder();
        TagResolver.Builder resolvers = TagResolver.builder();
        while (matcher.find()) {
            String name = matcher.group(1).toLowerCase(java.util.Locale.ROOT);
            matcher.appendReplacement(template, Matcher.quoteReplacement("<" + name + ">"));
            resolvers.resolver(Placeholder.unparsed(name, variables.getOrDefault(matcher.group(1), "")));
        }
        matcher.appendTail(template);
        return MiniMessage.miniMessage().deserialize(template.toString(), resolvers.build());
    }
}
