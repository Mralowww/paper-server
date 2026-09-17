package dev.advancedkit.advancedkit;

import dev.advancedkit.advancedkit.model.Kit;
import dev.advancedkit.advancedkit.storage.ItemStackSerializer;
import dev.advancedkit.advancedkit.storage.KitDatabase;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.permissions.PermissionAttachmentInfo;

import java.util.List;
import java.util.Optional;

public class KitManager {

    private final AdvancedKitPlugin plugin;
    private final KitDatabase database;

    public KitManager(AdvancedKitPlugin plugin, KitDatabase database) {
        this.plugin = plugin;
        this.database = database;
    }

    public enum CreateResult {
        SUCCESS, LIMIT_REACHED, ALREADY_EXISTS, EMPTY_INVENTORY
    }

    public enum ApplyResult {
        SUCCESS, ON_COOLDOWN, NOT_FOUND
    }

    public int getKitLimit(Player player) {
        if (player.hasPermission("advancedkit.limit.unlimited")) {
            return Integer.MAX_VALUE;
        }
        int highest = plugin.getConfig().getInt("default-kit-limit", 3);
        for (PermissionAttachmentInfo info : player.getEffectivePermissions()) {
            String node = info.getPermission();
            if (info.getValue() && node.startsWith("advancedkit.limit.")) {
                String suffix = node.substring("advancedkit.limit.".length());
                try {
                    int value = Integer.parseInt(suffix);
                    if (value > highest) {
                        highest = value;
                    }
                } catch (NumberFormatException ignored) {
                    // 非數字節點(例如 unlimited)已於上方處理
                }
            }
        }
        return highest;
    }

    public List<Kit> listOwnKits(Player player) {
        return database.listKits(player.getUniqueId().toString());
    }

    public List<Kit> listServerKits() {
        return database.listKits(Kit.SERVER_OWNER);
    }

    public CreateResult createFromInventory(Player player, String name, int cooldownSeconds) {
        String owner = player.getUniqueId().toString();
        if (database.findKit(owner, name).isPresent()) {
            return CreateResult.ALREADY_EXISTS;
        }
        if (database.countKits(owner) >= getKitLimit(player)) {
            return CreateResult.LIMIT_REACHED;
        }
        if (isInventoryEmpty(player)) {
            return CreateResult.EMPTY_INVENTORY;
        }
        saveSnapshot(owner, name, player, cooldownSeconds);
        return CreateResult.SUCCESS;
    }

    public Kit createServerKit(Player admin, String name, int cooldownSeconds) {
        String owner = Kit.SERVER_OWNER;
        if (database.findKit(owner, name).isPresent()) {
            return null;
        }
        return saveSnapshot(owner, name, admin, cooldownSeconds);
    }

    private Kit saveSnapshot(String owner, String name, Player player, int cooldownSeconds) {
        PlayerInventory inv = player.getInventory();
        String contents = ItemStackSerializer.serialize(inv.getStorageContents());
        String armor = ItemStackSerializer.serialize(inv.getArmorContents());
        ItemStack offhand = inv.getItemInOffHand();
        String offhandData = offhand.getType() == Material.AIR ? null : ItemStackSerializer.serializeSingle(offhand);
        String icon = firstNonEmptyMaterial(inv.getStorageContents(), inv.getArmorContents());
        return database.createKit(owner, name, contents, armor, offhandData, icon, cooldownSeconds);
    }

    public boolean saveExisting(Player player, Kit kit) {
        if (!kit.getOwnerUuid().equals(player.getUniqueId().toString()) && !kit.isServerKit()) {
            return false;
        }
        PlayerInventory inv = player.getInventory();
        String contents = ItemStackSerializer.serialize(inv.getStorageContents());
        String armor = ItemStackSerializer.serialize(inv.getArmorContents());
        ItemStack offhand = inv.getItemInOffHand();
        String offhandData = offhand.getType() == Material.AIR ? null : ItemStackSerializer.serializeSingle(offhand);
        return database.updateKitContents(kit.getId(), contents, armor, offhandData);
    }

    public boolean deleteKit(Kit kit) {
        return database.deleteKit(kit.getId());
    }

    public ApplyResult applyKit(Player player, Kit kit, boolean bypassCooldown) {
        long cooldownRemaining = 0;
        if (!bypassCooldown && kit.getCooldownSeconds() > 0 && !player.hasPermission("advancedkit.bypass.cooldown")) {
            cooldownRemaining = database.getCooldownRemainingMillis(
                    player.getUniqueId().toString(), kit.getId(), kit.getCooldownSeconds() * 1000L);
        }
        if (cooldownRemaining > 0) {
            return ApplyResult.ON_COOLDOWN;
        }

        PlayerInventory inv = player.getInventory();
        inv.setStorageContents(ItemStackSerializer.deserialize(kit.getContents()));
        inv.setArmorContents(ItemStackSerializer.deserialize(kit.getArmor()));
        if (kit.getOffhand() != null) {
            inv.setItemInOffHand(ItemStackSerializer.deserializeSingle(kit.getOffhand()));
        } else {
            inv.setItemInOffHand(new ItemStack(Material.AIR));
        }

        if (kit.getCooldownSeconds() > 0) {
            database.setCooldown(player.getUniqueId().toString(), kit.getId());
        }
        return ApplyResult.SUCCESS;
    }

    public long getRemainingCooldownSeconds(Player player, Kit kit) {
        if (kit.getCooldownSeconds() <= 0) {
            return 0;
        }
        long remainingMillis = database.getCooldownRemainingMillis(
                player.getUniqueId().toString(), kit.getId(), kit.getCooldownSeconds() * 1000L);
        return (remainingMillis + 999) / 1000;
    }

    public Optional<Kit> findOwnKit(Player player, String name) {
        return database.findKit(player.getUniqueId().toString(), name);
    }

    public Optional<Kit> findServerKit(String name) {
        return database.findKit(Kit.SERVER_OWNER, name);
    }

    private boolean isInventoryEmpty(Player player) {
        PlayerInventory inv = player.getInventory();
        for (ItemStack item : inv.getStorageContents()) {
            if (item != null && item.getType() != Material.AIR) {
                return false;
            }
        }
        for (ItemStack item : inv.getArmorContents()) {
            if (item != null && item.getType() != Material.AIR) {
                return false;
            }
        }
        return inv.getItemInOffHand().getType() == Material.AIR;
    }

    private String firstNonEmptyMaterial(ItemStack[] storage, ItemStack[] armor) {
        for (ItemStack item : storage) {
            if (item != null && item.getType() != Material.AIR) {
                return item.getType().name();
            }
        }
        for (ItemStack item : armor) {
            if (item != null && item.getType() != Material.AIR) {
                return item.getType().name();
            }
        }
        return Material.CHEST.name();
    }
}
