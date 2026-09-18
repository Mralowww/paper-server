package dev.kitforge.listener;

import dev.kitforge.KitForgePlugin;
import io.papermc.paper.event.player.AsyncChatEvent;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;

/** Feeds a player's next chat line into RenamePrompt instead of public chat while a rename is pending. */
public class RenameChatListener implements Listener {

    private final KitForgePlugin plugin;

    public RenameChatListener(KitForgePlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onChat(AsyncChatEvent event) {
        Player player = event.getPlayer();
        if (!plugin.getRenamePrompt().isAwaiting(player.getUniqueId())) return;
        event.setCancelled(true);
        String message = net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(event.message());
        Bukkit.getScheduler().runTask(plugin, () -> plugin.getRenamePrompt().submit(player.getUniqueId(), message));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        plugin.getRenamePrompt().cancel(event.getPlayer().getUniqueId());
    }
}
