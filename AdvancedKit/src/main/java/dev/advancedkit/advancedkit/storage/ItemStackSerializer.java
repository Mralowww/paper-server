package dev.advancedkit.advancedkit.storage;

import org.bukkit.inventory.ItemStack;
import org.bukkit.util.io.BukkitObjectInputStream;
import org.bukkit.util.io.BukkitObjectOutputStream;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;

public final class ItemStackSerializer {

    private ItemStackSerializer() {
    }

    public static String serialize(ItemStack[] items) {
        try (ByteArrayOutputStream byteOut = new ByteArrayOutputStream();
             BukkitObjectOutputStream dataOut = new BukkitObjectOutputStream(byteOut)) {
            dataOut.writeInt(items.length);
            for (ItemStack item : items) {
                dataOut.writeObject(item);
            }
            return Base64.getEncoder().encodeToString(byteOut.toByteArray());
        } catch (IOException e) {
            throw new RuntimeException("無法序列化物品欄", e);
        }
    }

    public static ItemStack[] deserialize(String data) {
        if (data == null || data.isEmpty()) {
            return new ItemStack[0];
        }
        try (ByteArrayInputStream byteIn = new ByteArrayInputStream(Base64.getDecoder().decode(data));
             BukkitObjectInputStream dataIn = new BukkitObjectInputStream(byteIn)) {
            int length = dataIn.readInt();
            ItemStack[] items = new ItemStack[length];
            for (int i = 0; i < length; i++) {
                items[i] = (ItemStack) dataIn.readObject();
            }
            return items;
        } catch (IOException | ClassNotFoundException e) {
            throw new RuntimeException("無法反序列化物品欄", e);
        }
    }

    public static String serializeSingle(ItemStack item) {
        return serialize(new ItemStack[]{item});
    }

    public static ItemStack deserializeSingle(String data) {
        ItemStack[] items = deserialize(data);
        return items.length > 0 ? items[0] : null;
    }
}
