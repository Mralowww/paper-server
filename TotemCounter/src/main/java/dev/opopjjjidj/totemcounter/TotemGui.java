package dev.opopjjjidj.totemcounter;

import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.List;

public class TotemGui {

    private static final int SIZE = 27;

    private TotemGui() {
    }

    public static Inventory open(TotemCounterPlugin plugin, Player target) {
        TotemGuiHolder holder = new TotemGuiHolder();
        Inventory inventory = plugin.getServer().createInventory(
                holder, SIZE, "圖騰 - " + target.getName());
        holder.setInventory(inventory);

        List<ItemStack> totems = new ArrayList<>();
        for (ItemStack item : target.getInventory().getStorageContents()) {
            if (item != null && item.getType() == Material.TOTEM_OF_UNDYING) {
                totems.add(item.clone());
            }
        }
        ItemStack offHand = target.getInventory().getItemInOffHand();
        if (offHand.getType() == Material.TOTEM_OF_UNDYING) {
            totems.add(offHand.clone());
        }

        int slot = 0;
        for (ItemStack totem : totems) {
            if (slot >= SIZE - 9) {
                break;
            }
            inventory.setItem(slot++, totem);
        }

        long totalPop = plugin.getDataManager()
                .getOrCreate(target.getUniqueId(), target.getName())
                .getTotalCount();
        int currentPop = plugin.getDataManager().getCurrentCount(target.getUniqueId());

        ItemStack info = new ItemStack(Material.TOTEM_OF_UNDYING);
        ItemMeta meta = info.getItemMeta();
        meta.setDisplayName("§e" + target.getName() + " 的圖騰資訊");
        meta.setLore(List.of(
                "§7身上持有: §f" + totems.size() + " 個圖騰",
                "§7本命計數: §f" + currentPop,
                "§7歷史總共 pop: §f" + totalPop + " 個圖騰"
        ));
        info.setItemMeta(meta);
        inventory.setItem(SIZE - 5, info);

        return inventory;
    }
}
