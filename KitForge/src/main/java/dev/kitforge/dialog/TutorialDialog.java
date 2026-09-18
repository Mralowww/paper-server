package dev.kitforge.dialog;

import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** First-run walkthrough shown via Paper's native Dialog GUI, using the real 1.21.6+ API directly (no reflection). */
public final class TutorialDialog {

    private TutorialDialog() {
    }

    private record Step(Material icon, String title, String... lines) {
    }

    private static final Step[] STEPS = {
            new Step(Material.CHEST, "<green><bold>步驟一：建立套裝</bold></green>", "<gray>打開任一個套裝格子，穿上想要的裝備。</gray>"),
            new Step(Material.HOPPER, "<yellow><bold>步驟二：儲存套裝</bold></yellow>", "<gray>編輯完成後點擊返回即可自動儲存。</gray>"),
            new Step(Material.NETHER_STAR, "<aqua><bold>步驟三：領取套裝</bold></aqua>", "<gray>在套裝選單左鍵點擊即可秒穿裝備。</gray>"),
            new Step(Material.ENDER_CHEST, "<light_purple><bold>步驟四：Kit 房間</bold></light_purple>", "<gray>房間有無限資源可以拿取，拿完後存成套裝。</gray>"),
            new Step(Material.SHIELD, "<gold><bold>步驟五：盔甲樣式</bold></gold>", "<gray>對盔甲 Shift+右鍵，即可設計花紋與材料。</gray>"),
            new Step(Material.ANVIL, "<red><bold>步驟六：鐵砧編輯</bold></red>", "<gray>對任一物品 Shift+右鍵，可以附魔、修復、改名。</gray>"),
    };

    public static void show(Player player, Runnable onAccept) {
        List<DialogBody> body = new ArrayList<>();
        for (Step step : STEPS) {
            body.add(DialogBody.item(new ItemStack(step.icon())).build());
            body.add(DialogBody.plainMessage(dev.kitforge.gui.ItemUtil.mm(step.title())));
            for (String line : step.lines()) {
                body.add(DialogBody.plainMessage(dev.kitforge.gui.ItemUtil.mm(line)));
            }
        }

        ActionButton button = ActionButton.builder(dev.kitforge.gui.ItemUtil.mm("<gradient:#55FF55:#00AA00><bold>了解了，開始使用！</bold></gradient>"))
                .action(DialogAction.customClick(
                        (view, audience) -> onAccept.run(),
                        ClickCallback.Options.builder().uses(1).build()
                ))
                .build();

        DialogBase base = DialogBase.builder(dev.kitforge.gui.ItemUtil.mm("<gradient:#55FFFF:#5555FF><bold>歡迎！套裝教學</bold></gradient>"))
                .body(body)
                .build();

        Dialog dialog = Dialog.create(factory -> factory.empty().base(base).type(DialogType.notice(button)));
        player.showDialog(dialog);
    }
}
