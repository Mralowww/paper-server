package dev.mralow.tierverify;

import org.bukkit.entity.Player;
import org.bukkit.plugin.messaging.PluginMessageListener;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 接收 TierBadge 模組(Fabric 客戶端)透過插件頻道送過來的已安裝模組清單。
 * 封包格式是 TierBadge 那邊自己定的,跟 Minecraft protocol 無關,純粹雙方講好的資料格式:
 * Int32 模組數量,接著每個模組寫兩個 UTF 字串(id、version),用 Java DataOutputStream/DataInputStream 對應的格式。
 */
public class ModListChannel implements PluginMessageListener {

    public static final String CHANNEL = "tierbadge:modlist";

    private static final int MAX_MODS = 2000;

    private final ModListService modListService;

    public ModListChannel(ModListService modListService) {
        this.modListService = modListService;
    }

    @Override
    public void onPluginMessageReceived(String channel, Player player, byte[] message) {
        if (!CHANNEL.equals(channel)) {
            return;
        }

        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(message))) {
            int count = in.readInt();
            if (count < 0 || count > MAX_MODS) {
                return;
            }

            List<ModListService.ModEntry> mods = new ArrayList<>(count);
            for (int i = 0; i < count; i++) {
                String id = in.readUTF();
                String version = in.readUTF();
                mods.add(new ModListService.ModEntry(id, version));
            }

            modListService.sendAsync(player.getUniqueId(), player.getName(), mods);
        } catch (IOException e) {
            // 封包格式對不上就直接丟掉,不要讓伺服器因為一包壞資料噴錯
        }
    }
}
