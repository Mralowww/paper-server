package dev.advancedkit.advancedkit.kitroom;

import org.bukkit.Material;

import java.util.List;

public class KitRoomItem {

    private final int slot;
    private final Material material;
    private final int amount;
    private final String displayName;
    private final List<String> lore;
    private final int customModelData;

    public KitRoomItem(int slot, Material material, int amount, String displayName,
                        List<String> lore, int customModelData) {
        this.slot = slot;
        this.material = material;
        this.amount = amount;
        this.displayName = displayName;
        this.lore = lore;
        this.customModelData = customModelData;
    }

    public int getSlot() {
        return slot;
    }

    public Material getMaterial() {
        return material;
    }

    public int getAmount() {
        return amount;
    }

    public String getDisplayName() {
        return displayName;
    }

    public List<String> getLore() {
        return lore;
    }

    public int getCustomModelData() {
        return customModelData;
    }
}
