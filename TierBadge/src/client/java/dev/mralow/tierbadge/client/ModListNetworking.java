package dev.mralow.tierbadge.client;

import dev.mralow.tierbadge.TierBadgeConfig;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.Collection;

/**
 * 進伺服器時把目前裝的所有 Fabric 模組清單,透過自訂插件頻道送給伺服器端的 TierVerify 插件看。
 * 沒裝 TierVerify 的伺服器根本不會註冊這個頻道,{@link ClientPlayNetworking#canSend} 會是 false,
 * 這種情況直接跳過,不會送出任何東西、也不會出錯。
 */
public final class ModListNetworking {

    private ModListNetworking() {
    }

    public static void register(TierBadgeConfig config) {
        PayloadTypeRegistry.playC2S().register(ModListPayload.ID, ModListPayload.CODEC);

        if (!config.sendModList) {
            return;
        }

        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            if (!ClientPlayNetworking.canSend(ModListPayload.ID)) {
                return;
            }
            byte[] payload = buildPayload();
            if (payload == null) {
                return;
            }
            ClientPlayNetworking.send(new ModListPayload(payload));
        });
    }

    /**
     * 格式是我們自己定的(跟 Minecraft 封包格式無關):Int32 模組數量,
     * 接著每個模組寫兩個 UTF 字串(id、version),對應 Java DataOutputStream 的標準格式,
     * 伺服器端的 TierVerify 插件用 DataInputStream 原樣讀回來就好。
     */
    private static byte[] buildPayload() {
        Collection<ModContainer> mods = FabricLoader.getInstance().getAllMods();
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
             DataOutputStream out = new DataOutputStream(bytes)) {
            out.writeInt(mods.size());
            for (ModContainer mod : mods) {
                out.writeUTF(mod.getMetadata().getId());
                out.writeUTF(mod.getMetadata().getVersion().getFriendlyString());
            }
            return bytes.toByteArray();
        } catch (IOException e) {
            TierBadgeClient.LOGGER.warn("組裝模組清單封包失敗: {}", e.getMessage());
            return null;
        }
    }
}
