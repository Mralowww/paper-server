package dev.mralow.tierbadge.client;

import net.minecraft.network.PacketByteBuf;
import net.minecraft.network.codec.PacketCodec;
import net.minecraft.network.packet.CustomPayload;
import net.minecraft.util.Identifier;

/**
 * 1.21.x 的 Fabric 網路 API 要求自訂頻道的封包實作 CustomPayload,不能再像舊版那樣直接塞 PacketByteBuf。
 * 編碼/解碼刻意不加任何長度前綴,直接對應原始 bytes,這樣伺服器端 TierVerify 插件(不是 Fabric,是
 * 用 Bukkit 的 PluginMessageListener 收原始 byte[])收到的資料才會跟 {@link ModListNetworking} 組出來的
 * DataOutputStream 格式完全一致,不用另外處理封包長度前綴。
 */
public record ModListPayload(byte[] data) implements CustomPayload {

    public static final CustomPayload.Id<ModListPayload> ID =
            new CustomPayload.Id<>(Identifier.of("tierbadge", "modlist"));

    public static final PacketCodec<PacketByteBuf, ModListPayload> CODEC = PacketCodec.of(
            (value, buf) -> buf.writeBytes(value.data()),
            buf -> {
                byte[] bytes = new byte[buf.readableBytes()];
                buf.readBytes(bytes);
                return new ModListPayload(bytes);
            }
    );

    @Override
    public Id<? extends CustomPayload> getId() {
        return ID;
    }
}
