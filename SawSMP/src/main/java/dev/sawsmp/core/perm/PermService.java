package dev.sawsmp.core.perm;

import com.google.gson.JsonElement;
import dev.sawsmp.core.SawSMPPlugin;
import dev.sawsmp.core.util.Sched;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.permissions.PermissionAttachment;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** 把網站「遊戲權限」設定的節點套用到玩家身上（拒絕優先），不需要其他權限插件。 */
public final class PermService {
    private final SawSMPPlugin plugin;
    private final Map<UUID, PermissionAttachment> attachments = new ConcurrentHashMap<>();

    public PermService(SawSMPPlugin plugin) { this.plugin = plugin; }

    public void refresh(Player p) {
        if (!plugin.api().configured()) return;
        plugin.api().get("/api/plugin/permissions/" + p.getUniqueId()).thenAccept(r -> {
            if (!r.ok()) return;
            Sched.entity(p, () -> {
                if (!p.isOnline()) return;
                clear(p);
                PermissionAttachment a = p.addAttachment(plugin);
                for (JsonElement e : r.body().getAsJsonArray("allow")) a.setPermission(e.getAsString(), true);
                for (JsonElement e : r.body().getAsJsonArray("deny")) a.setPermission(e.getAsString(), false);
                attachments.put(p.getUniqueId(), a);
                p.recalculatePermissions();
                p.updateCommands();
            });
        });
    }

    public void refreshAll() { Bukkit.getOnlinePlayers().forEach(this::refresh); }

    public void clear(Player p) {
        PermissionAttachment old = attachments.remove(p.getUniqueId());
        if (old != null) {
            try { p.removeAttachment(old); } catch (IllegalArgumentException ignored) { }
        }
    }

    public void clearAll() { Bukkit.getOnlinePlayers().forEach(this::clear); }
}
