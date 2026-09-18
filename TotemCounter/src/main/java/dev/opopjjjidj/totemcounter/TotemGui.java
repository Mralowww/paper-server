package dev.opopjjjidj.totemcounter;

import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.List;

public class TotemGui {

    private static final int SIZE = 9;

    private TotemGui() {
    }

    public static Inventory open(TotemCounterPlugin plugin, Player target) {
        TotemGuiHolder holder = new TotemGuiHolder();
        Inventory inventory = plugin.getServer().createInventory(
                holder, SIZE, "圖騰 - " + target.getName());
        holder.setInventory(inventory);

        int heldCount = countHeldTotems(target);

        long totalPop = plugin.getDataManager()
                .getOrCreate(target.getUniqueId(), target.getName())
                .getTotalCount();
        int currentPop = plugin.getDataManager().getCurrentCount(target.getUniqueId());

        ItemStack icon = new ItemStack(Material.TOTEM_OF_UNDYING, Math.max(1, Math.min(64, heldCount)));
        ItemMeta meta = icon.getItemMeta();
        meta.setDisplayName("§e" + target.getName() + " 的圖騰狀態");
        meta.setLore(List.of(
                "§7身上持有: §f" + heldCount + " 個圖騰",
                "§7本命計數: §f" + currentPop,
                "§7歷史總共 pop: §f" + totalPop + " 個圖騰"
        ));
        icon.setItemMeta(meta);
        inventory.setItem(4, icon);

        return inventory;
    }

    private static int countHeldTotems(Player target) {
        int count = 0;
        for (ItemStack item : target.getInventory().getStorageContents()) {
            if (item != null && item.getType() == Material.TOTEM_OF_UNDYING) {
                count += item.getAmount();
            }
        }
        ItemStack offHand = target.getInventory().getItemInOffHand();
        if (offHand.getType() == Material.TOTEM_OF_UNDYING) {
            count += offHand.getAmount();
        }
        return count;
    }
}
