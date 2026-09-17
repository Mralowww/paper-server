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
package dev.noah.perplayerkit.listeners;

import dev.noah.perplayerkit.anvil.RenamePrompt;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.Plugin;

/**
 * Feeds a player's next chat line into {@link RenamePrompt} instead of public
 * chat, while the anvil editor's rename button is waiting on them.
 * AsyncPlayerChatEvent (rather than Paper's newer chat event) is what stays
 * available all the way back to the 1.19 API this plugin compiles against.
 */
public class RenameChatListener implements Listener {

    private final Plugin plugin;

    public RenameChatListener(Plugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onChat(AsyncPlayerChatEvent e) {
        Player player = e.getPlayer();
        if (!RenamePrompt.isAwaiting(player.getUniqueId())) {
            return;
        }
        e.setCancelled(true);
        String message = e.getMessage();
        Bukkit.getScheduler().runTask(plugin, () -> RenamePrompt.submit(player.getUniqueId(), message));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        RenamePrompt.cancel(e.getPlayer().getUniqueId());
    }
}
