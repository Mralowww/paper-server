package dev.opopjjjidj.totemcounter;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.scheduler.BukkitTask;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class ActionBarManager {

    private static final String TEMPLATE =
            "<head:%s> <white>x<count> <sprite:\"minecraft:items\":item/totem_of_undying>";

    private final TotemCounterPlugin plugin;
    private final Set<UUID> enabled = ConcurrentHashMap.newKeySet();
    private final MiniMessage miniMessage = MiniMessage.miniMessage();
    private BukkitTask task;

    public ActionBarManager(TotemCounterPlugin plugin) {
        this.plugin = plugin;
    }

    public void start() {
        task = new BukkitRunnable() {
            @Override
            public void run() {
                tick();
            }
        }.runTaskTimer(plugin, 20L, 20L);
    }

    public void stop() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    public boolean toggle(UUID uuid) {
        if (enabled.contains(uuid)) {
            enabled.remove(uuid);
            return false;
        }
        enabled.add(uuid);
        return true;
    }

    public boolean isEnabled(UUID uuid) {
        return enabled.contains(uuid);
    }

    public void disable(UUID uuid) {
        enabled.remove(uuid);
    }

    private void tick() {
        for (UUID uuid : enabled) {
            Player player = plugin.getServer().getPlayer(uuid);
            if (player == null || !player.isOnline()) {
                continue;
            }
            int count = countHeldTotems(player);
            String template = String.format(TEMPLATE, player.getName());
            Component message = miniMessage.deserialize(template,
                    Placeholder.unparsed("count", String.valueOf(count)));
            player.sendActionBar(message);
        }
    }

    private int countHeldTotems(Player player) {
        int count = 0;
        for (ItemStack item : player.getInventory().getStorageContents()) {
            if (item != null && item.getType() == Material.TOTEM_OF_UNDYING) {
                count += item.getAmount();
            }
        }
        ItemStack offHand = player.getInventory().getItemInOffHand();
        if (offHand.getType() == Material.TOTEM_OF_UNDYING) {
            count += offHand.getAmount();
        }
        return count;
    }
}
