/*
 * Copyright 2022-2026 Noah Ross
 *
 * This file is part of PerPlayerKit.
 *
 * PerPlayerKit is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * PerPlayerKit is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for
 * more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with PerPlayerKit. If not, see <https://www.gnu.org/licenses/>.
 */
package dev.noah.perplayerkit.gui;

import com.google.common.primitives.Ints;
import dev.noah.perplayerkit.ItemFilter;
import dev.noah.perplayerkit.KitManager;
import dev.noah.perplayerkit.KitRoomDataManager;
import dev.noah.perplayerkit.PublicKit;
import dev.noah.perplayerkit.trim.TrimSession;
import dev.noah.perplayerkit.util.*;
import net.md_5.bungee.api.ChatColor;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.ipvp.canvas.Menu;
import org.ipvp.canvas.slot.Slot;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static dev.noah.perplayerkit.gui.ItemUtil.addHideFlags;
import static dev.noah.perplayerkit.gui.ItemUtil.createItem;
import static dev.noah.perplayerkit.gui.ItemUtil.createGlassPane;
import static dev.noah.perplayerkit.gui.GuiLayoutUtils.*;
import static dev.noah.perplayerkit.util.PlayerUtil.getPlayerName;
import dev.noah.perplayerkit.commands.core.ActionGuards;

public class GUI {
    private static final int PUBLIC_PAGE_SIZE = 27;
    private static final int TRIM_BUTTON_SLOT = 49;
    private static final int ANVIL_BUTTON_SLOT = 47;
    private static final Map<UUID, dev.noah.perplayerkit.anvil.EnchantSession> anvilSessions = new HashMap<>();
    private static final Map<UUID, TrimSession> trimSessions = new HashMap<>();
    // Every pattern on the 1.20.4 trim registry this plugin compiles against.
    private static final String[] TRIM_PATTERNS = {
            "sentry", "dune", "coast", "wild", "ward", "eye", "vex", "tide",
            "snout", "rib", "spire", "wayfinder", "shaper", "silence", "raiser", "host"
    };
    private static final Map<String, Material> TRIM_MATERIAL_ICONS = Map.ofEntries(
            Map.entry("QUARTZ", Material.QUARTZ),
            Map.entry("IRON", Material.IRON_INGOT),
            Map.entry("COPPER", Material.COPPER_INGOT),
            Map.entry("GOLD", Material.GOLD_INGOT),
            Map.entry("REDSTONE", Material.REDSTONE),
            Map.entry("LAPIS", Material.LAPIS_LAZULI),
            Map.entry("AMETHYST", Material.AMETHYST_SHARD),
            Map.entry("EMERALD", Material.EMERALD),
            Map.entry("DIAMOND", Material.DIAMOND),
            Map.entry("NETHERITE", Material.NETHERITE_INGOT)
    );
    private record MenuAccess(String permission, LocationFeature feature) {}
    private static final Map<Menu, MenuAccess> menuAccess = new java.util.WeakHashMap<>();

    public static boolean canUseMenu(Player player, Menu menu) {
        MenuAccess access = menuAccess.get(menu);
        return access == null || ActionGuards.allowed(player, access.permission(), access.feature());
    }

    private final Plugin plugin;
    private static final Set<UUID> kitDeletionFlag = new HashSet<>();
    private static final Set<UUID> clearedEditors = new HashSet<>();
    public static boolean takeClearFlag(Player player) { return clearedEditors.remove(player.getUniqueId()); }
    private static final Map<UUID, EditorContext> editorContexts = new HashMap<>();
    // Last main-menu page each player viewed, so back buttons from submenus
    // (kit room, public kits) return to it instead of resetting to page 1.
    private static final Map<UUID, Integer> lastMainMenuPage = new HashMap<>();

    public enum EditorType {
        KIT,
        PUBLIC_KIT,
        ENDERCHEST,
        INSPECT_KIT,
        INSPECT_ENDERCHEST
    }

    public record EditorContext(EditorType type, int slot, String id, UUID target, String playerName) {
    }

    public static EditorContext getAndRemoveEditorContext(UUID viewer) {
        return editorContexts.remove(viewer);
    }

    public static void forgetMainMenuPage(UUID player) {
        lastMainMenuPage.remove(player);
        clearedEditors.remove(player);
        editorContexts.remove(player);
    }

    private static void setEditorContext(Player viewer, EditorContext context) {
        editorContexts.put(viewer.getUniqueId(), context);
    }

    // Menus open through here so navigation between them works with canvas
    // redraw: any pending editor save is flushed first (a redraw reuses the
    // open inventory, so InventoryCloseEvent never fires for the editor), and
    // the stale title left behind by the reuse is updated in place.
    private void openMenu(Player p, GuiMenuFactory.TitledMenu titledMenu, String permission, LocationFeature feature) {
        flushOpenEditor(p);
        menuAccess.put(titledMenu.menu(), new MenuAccess(permission, feature));
        titledMenu.menu().open(p);
        GuiCompat.updateTitle(p, titledMenu.title());
    }

    private static void flushOpenEditor(Player p) {
        EditorContext context = editorContexts.remove(p.getUniqueId());
        if (context == null) {
            return;
        }
        Inventory top = p.getOpenInventory().getTopInventory();
        if (top.getSize() == MENU_SIZE && top.getLocation() == null) {
            EditorSaver.save(p, context, top);
        }
    }

    public GUI(Plugin plugin) {
        this.plugin = plugin;
    }

    public static void addLoadPublicKit(Slot slot, String id) {
        slot.setClickHandler((player, info) -> {
            if (!ActionGuards.allowed(player, "perplayerkit.publickit") || !ActionGuards.dataReady(player)) return;
            SoundManager.playClick(player);
            KitManager.get().loadPublicKit(player, id);
            info.getClickedMenu().close();
        });
    }

    public static boolean removeKitDeletionFlag(Player player) {
        return kitDeletionFlag.remove(player.getUniqueId());
    }

    private static String lang(String key) {
        return Lang.get().raw(key);
    }

    private static String lang(String key, String... pairs) {
        return Lang.get().raw(key, pairs);
    }

    public void OpenKitMenu(Player p, int slot) {
        if (!(ActionGuards.allowed(p, "perplayerkit.kit") && ActionGuards.dataReady(p))) return;
        if (!ItemFilter.get().isReady()) { Lang.get().send(p, "error.kitroom-not-ready"); return; }
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createKitMenu(slot);
        Menu menu = titledMenu.menu();

        ItemStack[] kit = ItemFilter.get().filterItemStack(KitManager.get().getPlayerKit(p.getUniqueId(), slot));
        if (kit != null) {
            for (int i = 0; i < KIT_CONTENT_END; i++) {
                menu.getSlot(i).setItem(kit[i]);
            }
        }
        allowModificationRange(menu, 0, KIT_CONTENT_END);
        setGlassPaneRange(menu, KIT_CONTENT_END, MENU_SIZE);
        setArmorAndOffhandIndicators(menu);

        menu.getSlot(IMPORT_SLOT).setItem(createItem(Material.CHEST, 1, lang("gui.import-button"), lang("gui.lore-import-inventory")));
        menu.getSlot(CLEAR_SLOT).setItem(createItem(Material.BARRIER, 1, lang("gui.clear-kit-button"), lang("gui.lore-shift-clear")));
        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
        addMainButton(menu.getSlot(BACK_SLOT), KitSlots.pageOf(slot));
        addClear(menu.getSlot(CLEAR_SLOT));
        addImport(menu.getSlot(IMPORT_SLOT));
        menu.getSlot(47).setItem(createItem(Material.NETHER_STAR, 1,
                lang("gui.item-action-title"), lang("gui.lore-shift-right-click")));
        attachItemContextMenu(menu, 0, KIT_CONTENT_END, slot);
        menu.setCursorDropHandler(Menu.ALLOW_CURSOR_DROPPING);

        openMenu(p, titledMenu, "perplayerkit.kit", LocationFeature.KITS);
        setEditorContext(p, new EditorContext(EditorType.KIT, slot, null, null, null));
    }

    /**
     * Shift+right-click on any non-empty item in the kit editor (not a fixed
     * button, so ClickOptions.ALLOW_ALL already lets every other click type
     * through untouched) pops the action menu for that exact item.
     */
    private void attachItemContextMenu(Menu kitMenu, int startInclusive, int endExclusive, int kitSlot) {
        for (int i = startInclusive; i < endExclusive; i++) {
            int itemIndex = i;
            kitMenu.getSlot(i).setClickHandler((player, info) -> {
                if (info.getClickType() != ClickType.SHIFT_RIGHT) {
                    return;
                }
                info.setResult(org.bukkit.event.Event.Result.DENY);
                ItemStack current = kitMenu.getSlot(itemIndex).getItem();
                if (current == null || current.getType() == Material.AIR) {
                    return;
                }
                SoundManager.playClick(player);
                openItemActionMenu(player, kitSlot, itemIndex, current.clone());
            });
        }
    }

    /** Small popup offering Anvil (enchant/repair/rename) and, for an armor piece, Armor Trim. */
    private void openItemActionMenu(Player p, int kitSlot, int itemIndex, ItemStack item) {
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createItemActionMenu();
        Menu menu = titledMenu.menu();
        for (int i = 0; i < 27; i++) {
            menu.getSlot(i).setItem(ItemUtil.createRainbowGlassPane(i));
        }

        menu.getSlot(11).setItem(addHideFlags(item.clone()));

        menu.getSlot(13).setItem(createItem(Material.ANVIL, 1,
                lang("gui.anvil-button"), lang("gui.lore-anvil-button")));
        menu.getSlot(13).setClickHandler((player, info) -> {
            if (!ActionGuards.allowed(player, "perplayerkit.anvil", LocationFeature.KITS)) return;
            SoundManager.playClick(player);
            anvilSessions.put(player.getUniqueId(), new dev.noah.perplayerkit.anvil.EnchantSession(kitSlot, itemIndex, item.clone()));
            openAnvilEnchantEditor(player);
        });

        TrimSession.Piece piece = TrimSession.Piece.fromKitSlotIndex(itemIndex);
        boolean trimEligible = piece != null && dev.noah.perplayerkit.trim.TrimCompat.isSupported()
                && dev.noah.perplayerkit.trim.TrimTierConfig.get().isEnabled()
                && dev.noah.perplayerkit.trim.TrimCompat.isArmorPiece(item);
        if (trimEligible) {
            menu.getSlot(15).setItem(createItem(Material.SHIELD, 1,
                    lang("gui.trim-button"), lang("gui.lore-trim-button")));
            menu.getSlot(15).setClickHandler((player, info) -> {
                if (!ActionGuards.allowed(player, "perplayerkit.trims", LocationFeature.KITS)) return;
                SoundManager.playClick(player);
                trimSessions.put(player.getUniqueId(), new TrimSession(kitSlot, piece, item.clone()));
                openTrimPatternSelect(player);
            });
        }

        menu.getSlot(22).setItem(createItem(Material.BARRIER, 1, lang("gui.back-button")));
        menu.getSlot(22).setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            OpenKitMenu(player, kitSlot);
        });

        openMenu(p, titledMenu, "perplayerkit.kit", LocationFeature.KITS);
    }

    private void openAnvilEnchantEditor(Player p) {
        dev.noah.perplayerkit.anvil.EnchantSession session = anvilSessions.get(p.getUniqueId());
        if (session == null) return;

        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createAnvilEnchantMenu();
        Menu menu = titledMenu.menu();
        for (int i = 0; i < MENU_SIZE; i++) {
            menu.getSlot(i).setItem(ItemUtil.createRainbowGlassPane(i));
        }

        menu.getSlot(4).setItem(addHideFlags(session.getItem().clone()));

        java.util.List<org.bukkit.enchantments.Enchantment> enchants = dev.noah.perplayerkit.anvil.EnchantEditor.applicableEnchants(session.getItem());
        int slotIndex = 19;
        for (org.bukkit.enchantments.Enchantment enchantment : enchants) {
            if (slotIndex >= 44) break;
            renderEnchantSlot(menu.getSlot(slotIndex), session, enchantment);
            slotIndex++;
            if ((slotIndex + 1) % 9 == 0) slotIndex += 2;
        }

        menu.getSlot(48).setItem(createItem(Material.EXPERIENCE_BOTTLE, 1,
                lang("gui.anvil-repair-button"), lang("gui.lore-anvil-repair")));
        menu.getSlot(48).setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (dev.noah.perplayerkit.anvil.EnchantEditor.repair(session.getItem())) {
                Lang.get().send(player, "success.anvil-repaired");
            }
            openAnvilEnchantEditor(player);
        });

        boolean canRename = dev.noah.perplayerkit.trim.TrimTierConfig.get().atLeastTier(p, "lt2");
        if (canRename) {
            menu.getSlot(50).setItem(createItem(Material.NAME_TAG, 1,
                    lang("gui.anvil-rename-button"), lang("gui.lore-anvil-rename")));
            menu.getSlot(50).setClickHandler((player, info) -> {
                SoundManager.playClick(player);
                promptRename(player, session);
            });
        } else {
            menu.getSlot(50).setItem(createItem(Material.BARRIER, 1,
                    lang("gui.anvil-rename-locked-name"), lang("gui.anvil-rename-locked-lore")));
            menu.getSlot(50).setClickHandler((player, info) -> {
                SoundManager.playFailure(player);
                Lang.get().send(player, "error.no-permission");
            });
        }

        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-and-save-button")));
        menu.getSlot(BACK_SLOT).setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            saveAnvilSessionAndReturn(player);
        });

        openMenu(p, titledMenu, "perplayerkit.anvil", LocationFeature.KITS);
    }

    private void renderEnchantSlot(Slot slot, dev.noah.perplayerkit.anvil.EnchantSession session, org.bukkit.enchantments.Enchantment enchantment) {
        int level = dev.noah.perplayerkit.anvil.EnchantEditor.currentLevel(session.getItem(), enchantment);
        String name = enchantment.getKey().getKey().replace('_', ' ');
        slot.setItem(createItem(level > 0 ? Material.ENCHANTED_BOOK : Material.BOOK, 1,
                lang("gui.anvil-enchant-name", "enchant", name, "level", String.valueOf(level), "max", String.valueOf(enchantment.getMaxLevel())),
                lang("gui.lore-anvil-enchant-add"),
                level > 0 ? lang("gui.lore-anvil-enchant-remove") : ""));
        slot.setClickHandler((player, info) -> {
            if (info.getClickType().isShiftClick()) {
                dev.noah.perplayerkit.anvil.EnchantEditor.removeEnchant(session.getItem(), enchantment);
                SoundManager.playClick(player);
                openAnvilEnchantEditor(player);
                return;
            }
            var result = dev.noah.perplayerkit.anvil.EnchantEditor.increaseLevel(session.getItem(), enchantment);
            switch (result) {
                case ADDED -> SoundManager.playClick(player);
                case MAX_LEVEL -> {
                    Lang.get().send(player, "error.anvil-max-level");
                    SoundManager.playFailure(player);
                }
                case CONFLICT -> {
                    Lang.get().send(player, "error.anvil-enchant-conflict");
                    SoundManager.playFailure(player);
                }
            }
            openAnvilEnchantEditor(player);
        });
    }

    private void promptRename(Player p, dev.noah.perplayerkit.anvil.EnchantSession session) {
        p.closeInventory();
        Lang.get().send(p, "info.anvil-rename-prompt");
        dev.noah.perplayerkit.anvil.RenamePrompt.await(p.getUniqueId(), text -> {
            if (!p.isOnline()) return;
            if (!text.equalsIgnoreCase("cancel")) {
                dev.noah.perplayerkit.anvil.EnchantEditor.rename(session.getItem(), text);
                Lang.get().send(p, "success.anvil-renamed");
            }
            openAnvilEnchantEditor(p);
        });
    }

    private void saveAnvilSessionAndReturn(Player p) {
        dev.noah.perplayerkit.anvil.EnchantSession session = anvilSessions.remove(p.getUniqueId());
        if (session == null) {
            OpenMainMenu(p);
            return;
        }
        ItemStack[] fullKit = KitManager.get().getPlayerKit(p.getUniqueId(), session.getKitSlot());
        if (fullKit != null && session.getItemIndex() < fullKit.length) {
            fullKit[session.getItemIndex()] = session.getItem();
            KitManager.get().savekit(p.getUniqueId(), session.getKitSlot(), fullKit, true);
        }
        OpenKitMenu(p, session.getKitSlot());
    }

    private void openTrimPatternSelect(Player p) {
        TrimSession session = trimSessions.get(p.getUniqueId());
        if (session == null) return;

        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createTrimPatternMenu();
        Menu menu = titledMenu.menu();
        for (int i = 0; i < MENU_SIZE; i++) {
            menu.getSlot(i).setItem(ItemUtil.createRainbowGlassPane(i));
        }

        int slotIndex = 10;
        for (String pattern : TRIM_PATTERNS) {
            Slot slot = menu.getSlot(slotIndex);
            slot.setItem(createItem(Material.PAPER, 1, lang("gui.trim-pattern-name", "pattern", capitalizeTrimKey(pattern))));
            slot.setClickHandler((player, info) -> {
                SoundManager.playClick(player);
                session.setPatternKey(pattern);
                openTrimMaterialSelect(player);
            });
            slotIndex++;
            if ((slotIndex + 1) % 9 == 0) slotIndex += 2;
        }

        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
        menu.getSlot(BACK_SLOT).setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            trimSessions.remove(player.getUniqueId());
            OpenKitMenu(player, session.getKitSlot());
        });

        openMenu(p, titledMenu, "perplayerkit.trims", LocationFeature.KITS);
    }

    private void openTrimMaterialSelect(Player p) {
        TrimSession session = trimSessions.get(p.getUniqueId());
        if (session == null) return;

        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createTrimMaterialMenu();
        Menu menu = titledMenu.menu();
        for (int i = 0; i < MENU_SIZE; i++) {
            menu.getSlot(i).setItem(ItemUtil.createRainbowGlassPane(i));
        }

        java.util.List<String> unlocked = dev.noah.perplayerkit.trim.TrimTierConfig.get().unlockedMaterials(p);
        java.util.List<dev.noah.perplayerkit.trim.TrimTier> tiers = dev.noah.perplayerkit.trim.TrimTierConfig.get().getTiers();
        int slotIndex = 10;
        for (dev.noah.perplayerkit.trim.TrimTier tier : tiers) {
            if (slotIndex >= 44) break;
            String materialKey = tier.materialKey();
            boolean unlockedHere = unlocked.contains(materialKey);
            Material icon = TRIM_MATERIAL_ICONS.getOrDefault(materialKey, Material.PAPER);
            Slot slot = menu.getSlot(slotIndex);
            if (unlockedHere) {
                slot.setItem(createItem(icon, 1, lang("gui.trim-material-name", "material", capitalizeTrimKey(materialKey))));
                slot.setClickHandler((player, info) -> {
                    SoundManager.playClick(player);
                    applyTrimAndReturn(player, materialKey);
                });
            } else {
                slot.setItem(createItem(Material.GRAY_DYE, 1,
                        lang("gui.trim-material-locked-name", "material", capitalizeTrimKey(materialKey)),
                        lang("gui.trim-material-locked-lore", "permission", tier.permission())));
                slot.setClickHandler((player, info) -> {
                    SoundManager.playFailure(player);
                    Lang.get().send(player, "error.no-permission");
                });
            }
            slotIndex++;
            if ((slotIndex + 1) % 9 == 0) slotIndex += 2;
        }

        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
        menu.getSlot(BACK_SLOT).setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            openTrimPatternSelect(player);
        });

        openMenu(p, titledMenu, "perplayerkit.trims", LocationFeature.KITS);
    }

    private void applyTrimAndReturn(Player p, String materialKey) {
        TrimSession session = trimSessions.remove(p.getUniqueId());
        if (session == null) return;

        // Re-checked here, not just when the material menu is drawn: the menu
        // only skips adding a click handler to locked slots, which is a UI
        // nicety, not a security boundary. This is the real gate.
        if (!dev.noah.perplayerkit.trim.TrimTierConfig.get().canUse(p, materialKey)) {
            Lang.get().send(p, "error.no-permission");
            SoundManager.playFailure(p);
            OpenKitMenu(p, session.getKitSlot());
            return;
        }

        ItemStack armor = session.getItem();
        if (armor != null && dev.noah.perplayerkit.trim.TrimCompat.apply(armor, session.getPatternKey(), materialKey)) {
            session.setItem(armor);
        }

        ItemStack[] fullKit = KitManager.get().getPlayerKit(p.getUniqueId(), session.getKitSlot());
        if (fullKit != null) {
            fullKit[session.getPiece().kitSlotIndex] = session.getItem();
            KitManager.get().savekit(p.getUniqueId(), session.getKitSlot(), fullKit, true);
        }

        Lang.get().send(p, "success.trim-applied");
        OpenKitMenu(p, session.getKitSlot());
    }

    private static String capitalizeTrimKey(String s) {
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    public void OpenPublicKitEditor(Player p, String kitId) {
        if (!(ActionGuards.allowed(p, "perplayerkit.admin"))) return;
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createPublicKitMenu(kitId);
        Menu menu = titledMenu.menu();

        ItemStack[] kit = KitManager.get().getPublicKit(kitId);
        if (kit != null) {
            for (int i = 0; i < KIT_CONTENT_END; i++) {
                menu.getSlot(i).setItem(kit[i]);
            }
        }
        allowModificationRange(menu, 0, KIT_CONTENT_END);
        setGlassPaneRange(menu, KIT_CONTENT_END, MENU_SIZE);
        setArmorAndOffhandIndicators(menu);

        menu.getSlot(IMPORT_SLOT).setItem(createItem(Material.CHEST, 1, lang("gui.import-button"), lang("gui.lore-import-inventory")));
        menu.getSlot(CLEAR_SLOT).setItem(createItem(Material.BARRIER, 1, lang("gui.clear-kit-button"), lang("gui.lore-shift-clear")));
        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
        addMainButton(menu.getSlot(BACK_SLOT));
        addClear(menu.getSlot(CLEAR_SLOT));
        addImport(menu.getSlot(IMPORT_SLOT));
        menu.setCursorDropHandler(Menu.ALLOW_CURSOR_DROPPING);

        openMenu(p, titledMenu, "perplayerkit.admin", null);
        setEditorContext(p, new EditorContext(EditorType.PUBLIC_KIT, 0, kitId, null, null));
    }

    public void OpenECKitKenu(Player p, int slot) {
        if (!(ActionGuards.allowed(p, "perplayerkit.enderchest") && ActionGuards.dataReady(p))) return;
        if (!ItemFilter.get().isReady()) { Lang.get().send(p, "error.kitroom-not-ready"); return; }
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createECMenu(slot);
        Menu menu = titledMenu.menu();

        setGlassPaneRange(menu, 0, EC_CONTENT_START);
        setGlassPaneRange(menu, EC_CONTENT_END, MENU_SIZE);
        ItemStack[] kit = ItemFilter.get().filterItemStack(KitManager.get().getPlayerEC(p.getUniqueId(), slot));
        if (kit != null) {
            for (int i = EC_CONTENT_START; i < EC_CONTENT_END; i++) {
                menu.getSlot(i).setItem(kit[i - EC_CONTENT_START]);
            }
        }
        allowModificationRange(menu, EC_CONTENT_START, EC_CONTENT_END);
        menu.getSlot(IMPORT_SLOT).setItem(createItem(Material.ENDER_CHEST, 1, lang("gui.import-button"), lang("gui.lore-import-ec")));
        menu.getSlot(CLEAR_SLOT).setItem(createItem(Material.BARRIER, 1, lang("gui.clear-kit-button"), lang("gui.lore-shift-clear")));
        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
        addMainButton(menu.getSlot(BACK_SLOT), KitSlots.pageOf(slot));
        addClear(menu.getSlot(CLEAR_SLOT), EC_CONTENT_START, EC_CONTENT_END);
        addImportEC(menu.getSlot(IMPORT_SLOT));
        menu.setCursorDropHandler(Menu.ALLOW_CURSOR_DROPPING);
        openMenu(p, titledMenu, "perplayerkit.enderchest", LocationFeature.ENDERCHESTS);
        setEditorContext(p, new EditorContext(EditorType.ENDERCHEST, slot, null, null, null));
    }

    public void InspectKit(Player p, UUID target, int slot) {
        String playerName = getPlayerName(target);
        if (playerName == null) {
            playerName = target.toString();
        }
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createInspectMenu(slot, playerName);
        Menu menu = titledMenu.menu();

        if (KitManager.get().hasKit(target, slot)) {
            ItemStack[] kit = KitManager.get().getItemStackArrayById(target.toString() + slot);
            for (int i = 0; i < KIT_CONTENT_END; i++) {
                menu.getSlot(i).setItem(kit[i]);
            }
        }
        setGlassPaneRange(menu, KIT_CONTENT_END, MENU_SIZE);
        setArmorAndOffhandIndicators(menu);

        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.close-button")));
        menu.getSlot(BACK_SLOT).setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            info.getClickedMenu().close();
            SoundManager.playCloseGui(player);
        });

        if (p.hasPermission("perplayerkit.admin")) {
            allowModificationRange(menu, 0, KIT_CONTENT_END);
            menu.getSlot(CLEAR_SLOT).setItem(createItem(Material.BARRIER, 1, lang("gui.clear-kit-button"), lang("gui.lore-shift-delete-kit")));
            addClearKit(menu.getSlot(CLEAR_SLOT), target, slot);
        }

        menu.setCursorDropHandler(Menu.ALLOW_CURSOR_DROPPING);
        openMenu(p, titledMenu, p.hasPermission("perplayerkit.admin") ? "perplayerkit.admin" : "perplayerkit.staff", null);
        setEditorContext(p, new EditorContext(EditorType.INSPECT_KIT, slot, null, target, playerName));
        SoundManager.playOpenGui(p);
    }

    public void InspectEc(Player p, UUID target, int slot) {
        String playerName = getPlayerName(target);
        if (playerName == null) {
            playerName = target.toString();
        }
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createInspectEcMenu(slot, playerName);
        Menu menu = titledMenu.menu();

        setGlassPaneRange(menu, 0, EC_CONTENT_START);
        setGlassPaneRange(menu, EC_CONTENT_END, MENU_SIZE);
        ItemStack[] kit = KitManager.get().getPlayerEC(target, slot);
        if (kit != null) {
            for (int i = EC_CONTENT_START; i < EC_CONTENT_END; i++) {
                menu.getSlot(i).setItem(kit[i - EC_CONTENT_START]);
            }
        }

        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.close-button")));
        menu.getSlot(BACK_SLOT).setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            info.getClickedMenu().close();
            SoundManager.playCloseGui(player);
        });

        if (p.hasPermission("perplayerkit.admin")) {
            allowModificationRange(menu, EC_CONTENT_START, EC_CONTENT_END);
            menu.getSlot(CLEAR_SLOT).setItem(createItem(Material.BARRIER, 1, lang("gui.clear-ec-button"), lang("gui.lore-shift-delete-ec")));
            addClearEnderchest(menu.getSlot(CLEAR_SLOT), target, slot);
        }

        menu.setCursorDropHandler(Menu.ALLOW_CURSOR_DROPPING);
        openMenu(p, titledMenu, p.hasPermission("perplayerkit.admin") ? "perplayerkit.admin" : "perplayerkit.staff", null);
        setEditorContext(p, new EditorContext(EditorType.INSPECT_ENDERCHEST, slot, null, target, playerName));
        SoundManager.playOpenGui(p);
    }

    public static final org.bukkit.NamespacedKey TUTORIAL_SEEN_KEY =
            new org.bukkit.NamespacedKey("perplayerkit", "seen_tutorial");

    public static boolean hasSeenTutorial(Player p) {
        return p.getPersistentDataContainer().has(TUTORIAL_SEEN_KEY, org.bukkit.persistence.PersistentDataType.BYTE);
    }

    private static void markTutorialSeen(Player p) {
        p.getPersistentDataContainer().set(TUTORIAL_SEEN_KEY, org.bukkit.persistence.PersistentDataType.BYTE, (byte) 1);
    }

    /**
     * Walkthrough for /kit: how to build, save, and style a kit. Shown once
     * automatically on a player's first /kit, and any time after that via
     * /kit tutorial.
     */
    public void OpenTutorial(Player p) {
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createTutorialMenu();
        Menu menu = titledMenu.menu();
        for (int i = 0; i < MENU_SIZE; i++) {
            menu.getSlot(i).setItem(ItemUtil.createRainbowGlassPane(i));
        }

        menu.getSlot(10).setItem(createItem(Material.CHEST, 1,
                lang("gui.tutorial-step1-name"),
                lang("gui.tutorial-step1-lore1"),
                lang("gui.tutorial-step1-lore2")));

        menu.getSlot(12).setItem(createItem(Material.HOPPER, 1,
                lang("gui.tutorial-step2-name"),
                lang("gui.tutorial-step2-lore1"),
                lang("gui.tutorial-step2-lore2")));

        menu.getSlot(14).setItem(createItem(Material.NETHER_STAR, 1,
                lang("gui.tutorial-step3-name"),
                lang("gui.tutorial-step3-lore1"),
                lang("gui.tutorial-step3-lore2")));

        menu.getSlot(16).setItem(createItem(Material.ENDER_CHEST, 1,
                lang("gui.tutorial-step4-name"),
                lang("gui.tutorial-step4-lore1"),
                lang("gui.tutorial-step4-lore2")));

        menu.getSlot(29).setItem(createItem(Material.SHIELD, 1,
                lang("gui.tutorial-step5-name"),
                lang("gui.tutorial-step5-lore1"),
                lang("gui.tutorial-step5-lore2")));

        menu.getSlot(31).setItem(createItem(Material.ANVIL, 1,
                lang("gui.tutorial-step6-name"),
                lang("gui.tutorial-step6-lore1"),
                lang("gui.tutorial-step6-lore2")));

        Slot startSlot = menu.getSlot(49);
        startSlot.setItem(createItem(Material.LIME_DYE, 1, lang("gui.tutorial-start-name")));
        startSlot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            markTutorialSeen(player);
            OpenMainMenu(player);
        });

        openMenu(p, titledMenu, "perplayerkit.menu", LocationFeature.MENU);
    }

    public void OpenMainMenu(Player p) {
        OpenMainMenu(p, 0);
    }

    public void OpenMainMenu(Player p, int page) {
        if (!(ActionGuards.allowed(p, "perplayerkit.menu") && ActionGuards.dataReady(p))) return;
        // Flush before reading kit data so the slot indicators reflect a kit
        // the player just finished editing.
        flushOpenEditor(p);
        int maxKits = KitSlots.maxKits();
        int pages = KitSlots.pageCount();
        page = Ints.constrainToRange(page, 0, pages - 1);
        int base = page * KitSlots.SLOTS_PER_PAGE;
        if (pages > 1) {
            lastMainMenuPage.put(p.getUniqueId(), page);
        }

        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createMainMenu(p, page, pages);
        Menu menu = titledMenu.menu();
        for (int i = 0; i < MENU_SIZE; i++) {
            menu.getSlot(i).setItem(createGlassPane());
        }
        // Three rows per kit slot: load/edit chest (row 1), enderchest (row 2),
        // status book (row 3). Columns past maxKits stay glass.
        for (int col = 0; col < KitSlots.SLOTS_PER_PAGE; col++) {
            int slotNum = base + col + 1;
            if (slotNum > maxKits) {
                break;
            }

            menu.getSlot(9 + col).setItem(createItem(Material.CHEST, 1,
                    lang("gui.kit-slot-name", "slot", String.valueOf(slotNum)),
                    lang("gui.lore-left-load"), lang("gui.lore-right-edit")));
            addEditLoad(menu.getSlot(9 + col), slotNum);

            if (KitManager.get().hasEC(p.getUniqueId(), slotNum)) {
                menu.getSlot(18 + col).setItem(createItem(Material.ENDER_CHEST, 1,
                        lang("gui.enderchest-slot-name", "slot", String.valueOf(slotNum)),
                        lang("gui.lore-left-load"), lang("gui.lore-right-edit")));
                addEditLoadEC(menu.getSlot(18 + col), slotNum);
            } else {
                menu.getSlot(18 + col).setItem(createItem(Material.ENDER_EYE, 1,
                        lang("gui.enderchest-slot-name", "slot", String.valueOf(slotNum)),
                        lang("gui.lore-click-create")));
                addEditEC(menu.getSlot(18 + col), slotNum);
            }

            if (KitManager.get().hasKit(p.getUniqueId(), slotNum)) {
                menu.getSlot(27 + col).setItem(createItem(Material.KNOWLEDGE_BOOK, 1, lang("gui.kit-exists"), lang("gui.lore-click-edit")));
            } else {
                menu.getSlot(27 + col).setItem(createItem(Material.BOOK, 1, lang("gui.kit-not-found"), lang("gui.lore-click-create")));
            }
            addEdit(menu.getSlot(27 + col), slotNum);
        }

        for (int i = 37; i < 44; i++) {
            menu.getSlot(i).setItem(createGlassPane());
        }

        menu.getSlot(37).setItem(createItem(Material.NETHER_STAR, 1, lang("gui.kit-room-button")));
        menu.getSlot(38).setItem(createItem(Material.BOOKSHELF, 1, lang("gui.premade-kits-button")));
        menu.getSlot(39).setItem(createItem(Material.OAK_SIGN, 1, lang("gui.info-button"),
                lang("gui.lore-info-load"), lang("gui.lore-info-edit"), lang("gui.lore-info-share")));
        menu.getSlot(41).setItem(createItem(Material.REDSTONE_BLOCK, 1, lang("gui.clear-inventory-button"), lang("gui.lore-shift-click")));
        menu.getSlot(42).setItem(createItem(Material.COMPASS, 1, lang("gui.share-kits-button"), lang("gui.lore-share-kits")));
        menu.getSlot(43).setItem(createItem(Material.EXPERIENCE_BOTTLE, 1, lang("gui.repair-items-button")));
        addRepairButton(menu.getSlot(43));
        addKitRoom(menu.getSlot(37));
        addPublicKitMenu(menu.getSlot(38));
        addClearButton(menu.getSlot(41));

        if (page > 0) {
            addPageArrow(menu, MAIN_PREV_PAGE_SLOT, "gui.previous-page-button", page - 1, pages);
        }
        if (page < pages - 1) {
            addPageArrow(menu, MAIN_NEXT_PAGE_SLOT, "gui.next-page-button", page + 1, pages);
        }

        menu.setCursorDropHandler(Menu.ALLOW_CURSOR_DROPPING);
        openMenu(p, titledMenu, "perplayerkit.menu", LocationFeature.MENU);
    }

    public void OpenKitRoom(Player p) {
        OpenKitRoom(p, 0);
    }

    public void OpenKitRoom(Player p, int page) {
        if (!ActionGuards.allowed(p, "perplayerkit.menu", LocationFeature.KIT_ROOM)) return;
        KitRoomDataManager room = KitRoomDataManager.get();
        int count = room.getPageCount();
        int current = Math.max(0, Math.min(page, count - 1));
        boolean grouped = count > 7;
        int buttonsPerGroup = grouped ? KitRoomDataManager.BUTTONS_PER_GROUP : 7;
        int first = current / buttonsPerGroup * buttonsPerGroup;
        int firstButtonSlot = !grouped && count > 5 ? 46 : 47;
        GuiMenuFactory.TitledMenu titledMenu = count > KitRoomDataManager.BUTTONS_PER_GROUP
                ? GuiMenuFactory.createKitRoomMenu(current + 1, count) : GuiMenuFactory.createKitRoomMenu();
        Menu menu = titledMenu.menu();
        allowModificationRange(menu, 0, FOOTER_START);
        setGlassPaneRange(menu, FOOTER_START, MENU_SIZE);
        ItemStack[] contents = room.getKitRoomPage(current);
        boolean editing = p.hasPermission("perplayerkit.editkitroom");
        if (!editing) contents = ItemFilter.get().filterItemStack(contents);
        for (int i = 0; i < FOOTER_START; i++) menu.getSlot(i).setItem(contents[i]);

        menu.getSlot(45).setItem(createItem(Material.BEACON, 1, lang("gui.refill-button")));
        addKitRoom(menu.getSlot(45), current);
        if (!editing) {
            menu.getSlot(53).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
            addMainButton(menu.getSlot(53));
        } else {
            menu.getSlot(53).setItem(createItem(Material.BARRIER, 1, lang("gui.edit-menu-button"),
                    lang("gui.edit-menu-lore"), lang("gui.kit-room-page-name", "page", String.valueOf(current + 1))));
            addKitRoomSaveButton(menu.getSlot(53), current);
        }
        for (int index = first; index < Math.min(count, first + buttonsPerGroup); index++) {
            Slot button = menu.getSlot(firstButtonSlot + index - first);
            String name = plugin.getConfig().getString("kitroom.items." + (index + 1) + ".name",
                    lang("gui.kit-room-page-name", "page", String.valueOf(index + 1)));
            button.setItem(addHideFlags(createItem(kitRoomIcon(index + 1), "<reset>" + name)));
            addKitRoom(button, index);
        }
        Slot selected = menu.getSlot(firstButtonSlot + current - first);
        selected.setItem(ItemUtil.addEnchantLook(selected.getItem(p)));
        if (first > 0) {
            menu.getSlot(46).setItem(createItem(Material.ARROW, 1, lang("gui.previous-page-button")));
            addKitRoom(menu.getSlot(46), first - 1);
        }
        if (first + buttonsPerGroup < count) {
            menu.getSlot(52).setItem(createItem(Material.ARROW, 1, lang("gui.next-page-button")));
            addKitRoom(menu.getSlot(52), first + buttonsPerGroup);
        }
        menu.setCursorDropHandler(Menu.ALLOW_CURSOR_DROPPING);
        openMenu(p, titledMenu, editing ? "perplayerkit.editkitroom" : "perplayerkit.menu", LocationFeature.KIT_ROOM);
    }

    private Material kitRoomIcon(int page) {
        String key = "kitroom.items." + page + ".material";
        String name = plugin.getConfig().getString(key, "CHEST");
        Material material = Material.matchMaterial(name);
        if (material != null && material.isItem() && !material.isAir()) return material;
        plugin.getLogger().warning("Invalid " + key + " '" + name + "'. Using CHEST.");
        return Material.CHEST;
    }

    public void ViewPublicKitMenu(Player p, String id) {
        if (!(ActionGuards.allowed(p, "perplayerkit.publickit"))) return;
        ItemStack[] kit = ItemFilter.get().filterItemStack(KitManager.get().getPublicKit(id));

        if (kit == null) {
            Lang.get().send(p, "error.kit-not-found-display");
            if (p.hasPermission("perplayerkit.admin")) {
                Lang.get().send(p, "info.assign-publickit-instruction");
            }
            return;
        }
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createViewPublicKitMenu(id);
        Menu menu = titledMenu.menu();

        for (int i = 0; i < MENU_SIZE; i++) {
            menu.getSlot(i).setItem(ItemUtil.createGlassPane());
        }

        for (int i = 9; i < 36; i++) {
            menu.getSlot(i).setItem(kit[i]);
        }
        for (int i = 0; i < 9; i++) {
            menu.getSlot(i + 36).setItem(kit[i]);
        }
        for (int i = 36; i < 41; i++) {
            menu.getSlot(i + 9).setItem(kit[i]);
        }

        setArmorAndOffhandIndicators(menu);
        menu.getSlot(LOAD_PUBLIC_KIT_SLOT).setItem(createItem(Material.APPLE, 1, lang("gui.load-kit-button")));
        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
        addPublicKitMenu(menu.getSlot(BACK_SLOT));
        addLoadPublicKit(menu.getSlot(LOAD_PUBLIC_KIT_SLOT), id);

        openMenu(p, titledMenu, "perplayerkit.publickit", LocationFeature.PUBLIC_KITS);
    }

    public void OpenPublicKitMenu(Player player) { OpenPublicKitMenu(player, 0); }

    public void OpenPublicKitMenu(Player player, int page) {
        if (!ActionGuards.allowed(player, "perplayerkit.publickit")) return;
        List<PublicKit> allKits = KitManager.get().getPublicKitList();
        int pages = Math.max(1, (allKits.size() + PUBLIC_PAGE_SIZE - 1) / PUBLIC_PAGE_SIZE);
        int current = Math.max(0, Math.min(page, pages - 1));
        GuiMenuFactory.TitledMenu titledMenu = GuiMenuFactory.createPublicKitRoomMenu();
        Menu menu = titledMenu.menu();
        for (int i = 0; i < MENU_SIZE; i++) {
            menu.getSlot(i).setItem(ItemUtil.createGlassPane());
        }

        for (int i = 18; i < 36; i++) {
            menu.getSlot(i).setItem(ItemUtil.createItem(Material.BOOK, 1, lang("gui.more-kits-coming")));
        }

        List<PublicKit> publicKitList = allKits.subList(current * PUBLIC_PAGE_SIZE, Math.min(allKits.size(), (current + 1) * PUBLIC_PAGE_SIZE));

        for (int i = 0; i < publicKitList.size(); i++) {
            PublicKit kit = publicKitList.get(i);
            if (KitManager.get().hasPublicKit(kit.id)) {
                if (player.hasPermission("perplayerkit.admin")) {
                    menu.getSlot(i + 9).setItem(createItem(kit.icon, 1, ChatColor.RESET + kit.name, lang("gui.lore-admin-shift-edit")));
                } else {
                    menu.getSlot(i + 9).setItem(createItem(kit.icon, 1, ChatColor.RESET + kit.name));
                }
                addPublicKitButton(menu.getSlot(i + 9), kit.id);
            } else {
                String unassignedName = ChatColor.RESET + kit.name + " " + lang("gui.unassigned-tag");
                if (player.hasPermission("perplayerkit.admin")) {
                    menu.getSlot(i + 9).setItem(createItem(kit.icon, 1, unassignedName,
                            lang("gui.lore-unassigned-info"), lang("gui.lore-admin-shift-edit")));
                } else {
                    menu.getSlot(i + 9).setItem(createItem(kit.icon, 1, unassignedName, lang("gui.lore-unassigned-info")));
                }
            }

            if (player.hasPermission("perplayerkit.admin")) {
                addAdminPublicKitButton(menu.getSlot(i + 9), kit.id);
            }
        }

        if (current > 0) {
            menu.getSlot(45).setItem(createItem(Material.ARROW, 1, lang("gui.previous-page-button")));
            menu.getSlot(45).setClickHandler((p, info) -> OpenPublicKitMenu(p, current - 1));
        }
        if (current + 1 < pages) {
            menu.getSlot(52).setItem(createItem(Material.ARROW, 1, lang("gui.next-page-button")));
            menu.getSlot(52).setClickHandler((p, info) -> OpenPublicKitMenu(p, current + 1));
        }
        addMainButton(menu.getSlot(BACK_SLOT));
        menu.getSlot(BACK_SLOT).setItem(createItem(Material.OAK_DOOR, 1, lang("gui.back-button")));
        openMenu(player, titledMenu, "perplayerkit.publickit", LocationFeature.PUBLIC_KITS);
    }

    public void addClear(Slot slot) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isShiftClick()) {
                clearedEditors.add(player.getUniqueId());
                Menu m = info.getClickedMenu();
                for (int i = 0; i < 41; i++) {
                    m.getSlot(i).setItem((org.bukkit.inventory.ItemStack) null);
                }
            }
        });
    }

    public void addClear(Slot slot, int start, int end) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isShiftClick()) {
                clearedEditors.add(player.getUniqueId());
                Menu m = info.getClickedMenu();
                for (int i = start; i < end; i++) {
                    m.getSlot(i).setItem((org.bukkit.inventory.ItemStack) null);
                }
            }
        });
    }

    public void addClearKit(Slot slot, UUID target, int slotNum) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isShiftClick()) {
                KitManager.get().deleteKit(target, slotNum);
                Lang.get().send(player, "success.admin-kit-deleted", "slot", String.valueOf(slotNum));
                SoundManager.playSuccess(player);
                kitDeletionFlag.add(player.getUniqueId());
                info.getClickedMenu().close();
                SoundManager.playCloseGui(player);
            }
        });
    }

    public void addClearEnderchest(Slot slot, UUID target, int slotNum) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isShiftClick()) {
                KitManager.get().deleteEnderchest(target, slotNum);
                Lang.get().send(player, "success.admin-ec-deleted", "slot", String.valueOf(slotNum));
                SoundManager.playSuccess(player);
                kitDeletionFlag.add(player.getUniqueId());
                info.getClickedMenu().close();
                SoundManager.playCloseGui(player);
            }
        });
    }

    public void addPublicKitButton(Slot slot, String id) {
        slot.setClickHandler((player, info) -> {
            if (!ActionGuards.allowed(player, "perplayerkit.publickit") || !ActionGuards.dataReady(player)) return;
            SoundManager.playClick(player);
            if (info.getClickType() == ClickType.LEFT) {
                KitManager.get().loadPublicKit(player, id);
                info.getClickedMenu().close();
            } else if (info.getClickType() == ClickType.RIGHT) {
                ViewPublicKitMenu(player, id);
            }
        });
    }

    public void addAdminPublicKitButton(Slot slot, String id) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isShiftClick()) {
                OpenPublicKitEditor(player, id);
                return;
            }
            if (info.getClickType() == ClickType.LEFT) {
                KitManager.get().loadPublicKit(player, id);
            } else if (info.getClickType() == ClickType.RIGHT) {
                ViewPublicKitMenu(player, id);
            }
        });
    }

    public void addMainButton(Slot slot) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            OpenMainMenu(player, lastMainMenuPage.getOrDefault(player.getUniqueId(), 0));
        });
    }

    public void addMainButton(Slot slot, int page) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            OpenMainMenu(player, page);
        });
    }

    private void addPageArrow(Menu menu, int guiSlot, String nameKey, int targetPage, int pages) {
        menu.getSlot(guiSlot).setItem(createItem(Material.ARROW, 1, lang(nameKey),
                lang("gui.lore-page-indicator", "page", String.valueOf(targetPage + 1), "pages", String.valueOf(pages))));
        addMainButton(menu.getSlot(guiSlot), targetPage);
    }

    public void addKitRoom(Slot slot) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            OpenKitRoom(player);
            BroadcastManager.get().broadcastPlayerOpenedKitRoom(player);
        });
    }

    public void addKitRoom(Slot slot, int page) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            OpenKitRoom(player, page);
        });
    }

    public void addPublicKitMenu(Slot slot) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            OpenPublicKitMenu(player);
        });
    }

    public void addKitRoomSaveButton(Slot slot, int page) {
        slot.setClickHandler((player, info) -> {
            if (!info.getClickType().isRightClick() || !info.getClickType().isShiftClick()) {
                return;
            }
            if (!ActionGuards.allowed(player, "perplayerkit.editkitroom")) {
                return;
            }
            Inventory top = player.getOpenInventory().getTopInventory();
            ItemStack[] data = new ItemStack[FOOTER_START];
            for (int i = 0; i < FOOTER_START; i++) {
                ItemStack item = top.getItem(i);
                data[i] = item == null ? null : item.clone();
            }
            KitRoomDataManager.get().setKitRoom(page, data);
            KitRoomDataManager.get().savePagesToDBAsync(List.of(page));
            Lang.get().send(player, "success.kitroom-menu-saved");
            SoundManager.playSuccess(player);
        });
    }

    public void addRepairButton(Slot slot) {
        slot.setClickHandler((player, info) -> {
            if (!ActionGuards.allowed(player, "perplayerkit.repair") || !ActionGuards.dataReady(player)) return;
            SoundManager.playClick(player);
            BroadcastManager.get().broadcastPlayerRepaired(player);
            PlayerUtil.repairAll(player);
            player.updateInventory();
            SoundManager.playSuccess(player);
        });
    }

    public void addClearButton(Slot slot) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isShiftClick()) {
                player.getInventory().clear();
                Lang.get().send(player, "success.inventory-cleared");
                SoundManager.playSuccess(player);
            }
        });
    }

    public void addImport(Slot slot) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            Menu m = info.getClickedMenu();
            ItemStack[] inv;
            if (ItemFilter.get().filtersImports()) {
                if (!ItemFilter.get().isReady()) { Lang.get().send(player, "error.kitroom-not-ready"); return; }
                inv = ItemFilter.get().filterKit(player.getInventory().getContents(), player);
                if (inv == null) return;
            } else {
                inv = dev.noah.perplayerkit.KitContents.copy(player.getInventory().getContents());
            }
            for (int i = 0; i < 41; i++) {
                m.getSlot(i).setItem(inv[i]);
            }
        });
    }

    public void addImportEC(Slot slot) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            Menu m = info.getClickedMenu();
            ItemStack[] inv;
            if (ItemFilter.get().filtersImports()) {
                if (!ItemFilter.get().isReady()) { Lang.get().send(player, "error.kitroom-not-ready"); return; }
                inv = ItemFilter.get().filterKit(player.getEnderChest().getContents(), player);
                if (inv == null) return;
            } else {
                inv = dev.noah.perplayerkit.KitContents.copy(player.getEnderChest().getContents());
            }
            for (int i = 0; i < 27; i++) {
                m.getSlot(i + 9).setItem(inv[i]);
            }
        });
    }

    public void addEdit(Slot slot, int i) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isLeftClick() || info.getClickType().isRightClick()) {
                OpenKitMenu(player, i);
            }
        });
    }

    public void addEditEC(Slot slot, int i) {
        slot.setClickHandler((player, info) -> {
            SoundManager.playClick(player);
            if (info.getClickType().isLeftClick() || info.getClickType().isRightClick()) {
                OpenECKitKenu(player, i);
            }
        });
    }

    public void addLoad(Slot slot, int i) {
        slot.setClickHandler((player, info) -> {
            if (!ActionGuards.allowed(player, "perplayerkit.kit") || !ActionGuards.dataReady(player)) return;
            SoundManager.playClick(player);
            if (info.getClickType() == ClickType.LEFT || info.getClickType() == ClickType.SHIFT_LEFT) {
                KitManager.get().loadKit(player, i);
                info.getClickedMenu().close();
                SoundManager.playCloseGui(player);
            }
        });
    }

    public void addEditLoad(Slot slot, int i) {
        slot.setClickHandler((player, info) -> {
            if (!ActionGuards.allowed(player, "perplayerkit.kit") || !ActionGuards.dataReady(player)) return;
            SoundManager.playClick(player);
            if (info.getClickType() == ClickType.LEFT || info.getClickType() == ClickType.SHIFT_LEFT) {
                KitManager.get().loadKit(player, i);
                info.getClickedMenu().close();
            } else if (info.getClickType() == ClickType.RIGHT || info.getClickType() == ClickType.SHIFT_RIGHT) {
                OpenKitMenu(player, i);
            }
        });
    }

    public void addEditLoadEC(Slot slot, int i) {
        slot.setClickHandler((player, info) -> {
            if (!ActionGuards.allowed(player, "perplayerkit.enderchest") || !ActionGuards.dataReady(player)) return;
            SoundManager.playClick(player);
            if (info.getClickType() == ClickType.LEFT || info.getClickType() == ClickType.SHIFT_LEFT) {
                KitManager.get().loadEnderchest(player, i);
                info.getClickedMenu().close();
            } else if (info.getClickType() == ClickType.RIGHT || info.getClickType() == ClickType.SHIFT_RIGHT) {
                OpenECKitKenu(player, i);
            }
        });
    }
}
