package dev.mnm.paper.inventory;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;

/** Converts items to the backend's JSON form and back. Must run on the server thread. */
final class ItemCodec {
    private static final PlainTextComponentSerializer PLAIN = PlainTextComponentSerializer.plainText();
    private static final HexFormat HEX = HexFormat.of();

    private ItemCodec() {}

    static boolean isEmpty(ItemStack item) {
        return item == null || item.isEmpty();
    }

    /** SHA-256 of the item's full serialized form (null for empty slots). */
    static String fingerprint(ItemStack item) {
        return isEmpty(item) ? null : sha256(item.serializeAsBytes());
    }

    static JsonObject container(Inventory inventory, int size) {
        JsonArray items = new JsonArray();
        StringBuilder all = new StringBuilder();
        for (int slot = 0; slot < size; slot++) {
            ItemStack item = inventory.getItem(slot);
            if (isEmpty(item)) continue;
            JsonObject json = encode(slot, item);
            items.add(json);
            all.append(slot).append(':').append(json.get("fp").getAsString()).append(';');
        }
        JsonObject snapshot = new JsonObject();
        snapshot.add("items", items);
        snapshot.addProperty("fp", sha256(all.toString().getBytes(StandardCharsets.UTF_8)));
        return snapshot;
    }

    static JsonObject encode(int slot, ItemStack item) {
        byte[] bytes = item.serializeAsBytes();
        JsonObject json = new JsonObject();
        json.addProperty("slot", slot);
        json.addProperty("id", item.getType().getKey().toString());
        json.addProperty("amount", item.getAmount());
        json.addProperty("fp", sha256(bytes));
        json.addProperty("data", Base64.getEncoder().encodeToString(bytes));
        ItemMeta meta = item.getItemMeta();
        if (meta != null) {
            Component name = meta.customName();
            if (name != null) json.addProperty("name", truncate(PLAIN.serialize(name), 100));
            List<Component> lore = meta.lore();
            if (lore != null && !lore.isEmpty()) {
                JsonArray lines = new JsonArray();
                lore.stream().limit(20).forEach(line -> lines.add(truncate(PLAIN.serialize(line), 200)));
                json.add("lore", lines);
            }
            if (meta.hasEnchants()) {
                JsonObject enchants = new JsonObject();
                meta.getEnchants().forEach((enchantment, level) -> enchants.addProperty(enchantment.getKey().toString(), Math.min(255, level)));
                json.add("enchantments", enchants);
            }
            if (meta instanceof Damageable damageable && damageable.hasMaxDamage()) {
                json.addProperty("damage", damageable.getDamage());
                json.addProperty("maxDamage", damageable.getMaxDamage());
            }
        }
        return json;
    }

    /**
     * Builds the desired item. Starts from server-provided data when present
     * (keeps all other components), otherwise from the material.
     *
     * @throws IllegalArgumentException when the description is invalid on this server
     */
    static ItemStack decode(JsonObject after) {
        Material material = Material.matchMaterial(after.get("id").getAsString());
        if (material == null || !material.isItem() || material.isAir()) throw new IllegalArgumentException("Unknown item " + after.get("id").getAsString());
        ItemStack item = after.has("data") && !after.get("data").isJsonNull()
                ? ItemStack.deserializeBytes(Base64.getDecoder().decode(after.get("data").getAsString()))
                : ItemStack.of(material);
        if (item.getType() != material) throw new IllegalArgumentException("Item data does not match " + material.getKey());
        int amount = after.get("amount").getAsInt();
        if (amount < 1 || amount > item.getMaxStackSize()) throw new IllegalArgumentException("Amount " + amount + " exceeds the stack size of " + material.getKey());
        item.setAmount(amount);

        item.editMeta(meta -> {
            if (after.has("name")) {
                JsonElement name = after.get("name");
                meta.customName(name.isJsonNull() ? null : Component.text(name.getAsString()).decoration(TextDecoration.ITALIC, false));
            }
            if (after.has("lore")) {
                List<Component> lines = new ArrayList<>();
                after.getAsJsonArray("lore").forEach(l -> lines.add(Component.text(l.getAsString()).decoration(TextDecoration.ITALIC, false)));
                meta.lore(lines.isEmpty() ? null : lines);
            }
            if (after.has("enchantments")) {
                for (Enchantment existing : Map.copyOf(meta.getEnchants()).keySet()) meta.removeEnchant(existing);
                for (Map.Entry<String, JsonElement> e : after.getAsJsonObject("enchantments").entrySet()) {
                    NamespacedKey key = NamespacedKey.fromString(e.getKey());
                    Enchantment enchantment = key == null ? null : RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT).get(key);
                    if (enchantment == null) throw new IllegalArgumentException("Unknown enchantment " + e.getKey());
                    meta.addEnchant(enchantment, e.getValue().getAsInt(), true);
                }
            }
        });
        return item;
    }

    static String sha256(byte[] data) {
        try {
            return HEX.formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
