package dev.mralow.tierbadge.mixin;

import dev.mralow.tierbadge.TierCache;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * PlayerEntity#getDisplayName() 這個 Text 會被拿去用在頭頂名牌、Tab 名單等大部分「玩家名稱顯示」的地方,
 * 所以只要在這裡加一次尾巴,遊戲裡大部分看得到玩家名稱的地方都會一起顯示 Tier,不用個別 mixin 每個渲染點。
 *
 * 如果換了 Minecraft 版本後編譯失敗,先確認這個方法名稱/簽章在新版 Yarn mappings 底下有沒有變。
 */
@Mixin(PlayerEntity.class)
public abstract class PlayerDisplayNameMixin {

    @Inject(method = "getDisplayName", at = @At("RETURN"), cancellable = true)
    private void tierbadge$appendTier(CallbackInfoReturnable<Text> cir) {
        PlayerEntity self = (PlayerEntity) (Object) this;
        String tier = TierCache.getTier(self.getGameProfile().getName());
        if (tier == null) {
            return;
        }

        Text original = cir.getReturnValue();
        Text badge = Text.literal(" [" + tier + "]").withColor(TierCache.formatColor(tier));
        cir.setReturnValue(Text.empty().append(original).append(badge));
    }
}
