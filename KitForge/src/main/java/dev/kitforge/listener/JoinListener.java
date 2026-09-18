package dev.kitforge.listener;

import dev.kitforge.KitForgePlugin;
import dev.kitforge.gui.ItemUtil;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.persistence.PersistentDataType;

public class JoinListener implements Listener {

    private static final NamespacedKey SEEN_TUTORIAL = new NamespacedKey("kitforge", "seen_tutorial");

    private final KitForgePlugin plugin;

    public JoinListener(KitForgePlugin plugin) {
        this.plugin = plugin;
    }

    public static boolean hasSeenTutorial(Player player) {
        return player.getPersistentDataContainer().has(SEEN_TUTORIAL, PersistentDataType.BYTE);
    }

    public static void markTutorialSeen(Player player) {
        player.getPersistentDataContainer().set(SEEN_TUTORIAL, PersistentDataType.BYTE, (byte) 1);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        if (!hasSeenTutorial(player)) {
            dev.kitforge.dialog.TutorialDialog.show(player, () -> markTutorialSeen(player));
        }
    }
}
