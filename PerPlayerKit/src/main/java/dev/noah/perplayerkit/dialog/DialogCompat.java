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
package dev.noah.perplayerkit.dialog;

import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Paper's native "Dialog" screens (io.papermc.paper.dialog.*) only exist on
 * Paper 1.21.6+, and this plugin still compiles against the older Spigot API
 * for broad version support. Everything here is reached through reflection so
 * the rest of the plugin never touches those types directly.
 * {@link #isSupported()} is false anywhere the classes don't exist, and every
 * public method here fails soft (returns false / does nothing) rather than
 * throwing, so a caller can always fall back to a chest-menu equivalent.
 */
public final class DialogCompat {

    private static final Logger LOGGER = Logger.getLogger("PerPlayerKit");

    private static final boolean SUPPORTED;

    private static Class<?> dialogClass;
    private static Class<?> dialogLikeClass;
    private static Class<?> dialogBaseClass;
    private static Class<?> dialogTypeClass;
    private static Class<?> actionButtonClass;
    private static Class<?> dialogActionClass;
    private static Class<?> dialogActionCallbackClass;
    private static Class<?> dialogBodyClass;
    private static Class<?> clickCallbackOptionsClass;
    private static Class<?> registryBuilderFactoryClass;
    private static Class<?> dialogRegistryEntryBuilderClass;

    private static Method dialogCreate;
    private static Method playerShowDialog;
    private static Method dialogBaseBuilder;
    private static Method dialogBaseBuilderBody;
    private static Method dialogBaseBuilderBuild;
    private static Method dialogTypeNotice;
    private static Method actionButtonBuilder;
    private static Method actionButtonBuilderTooltip;
    private static Method actionButtonBuilderAction;
    private static Method actionButtonBuilderBuild;
    private static Method dialogActionCustomClick;
    private static Method clickCallbackOptionsBuilder;
    private static Method clickCallbackOptionsBuilderUses;
    private static Method clickCallbackOptionsBuilderBuild;
    private static Method dialogBodyPlainMessage;
    private static Method dialogBodyItem;
    private static Method registryBuilderFactoryEmpty;
    private static Method entryBuilderBase;
    private static Method entryBuilderType;

    static {
        boolean ok;
        try {
            dialogClass = Class.forName("io.papermc.paper.dialog.Dialog");
            dialogLikeClass = Class.forName("io.papermc.paper.dialog.DialogLike");
            dialogBaseClass = Class.forName("io.papermc.paper.registry.data.dialog.DialogBase");
            dialogTypeClass = Class.forName("io.papermc.paper.registry.data.dialog.type.DialogType");
            actionButtonClass = Class.forName("io.papermc.paper.registry.data.dialog.ActionButton");
            dialogActionClass = Class.forName("io.papermc.paper.registry.data.dialog.action.DialogAction");
            dialogActionCallbackClass = Class.forName("io.papermc.paper.registry.data.dialog.action.DialogActionCallback");
            dialogBodyClass = Class.forName("io.papermc.paper.registry.data.dialog.body.DialogBody");
            clickCallbackOptionsClass = Class.forName("net.kyori.adventure.text.event.ClickCallback$Options");
            Class<?> dialogRegistryEntryClass = Class.forName("io.papermc.paper.registry.data.dialog.DialogRegistryEntry");
            dialogRegistryEntryBuilderClass = Class.forName("io.papermc.paper.registry.data.dialog.DialogRegistryEntry$Builder");
            registryBuilderFactoryClass = Class.forName("io.papermc.paper.registry.RegistryBuilderFactory");

            dialogCreate = dialogClass.getMethod("create", java.util.function.Consumer.class);
            playerShowDialog = Class.forName("net.kyori.adventure.audience.Audience")
                    .getMethod("showDialog", dialogLikeClass);

            dialogBaseBuilder = dialogBaseClass.getMethod("builder", Component.class);
            Class<?> dialogBaseBuilderClass = Class.forName("io.papermc.paper.registry.data.dialog.DialogBase$Builder");
            dialogBaseBuilderBody = dialogBaseBuilderClass.getMethod("body", List.class);
            dialogBaseBuilderBuild = dialogBaseBuilderClass.getMethod("build");

            dialogTypeNotice = dialogTypeClass.getMethod("notice", actionButtonClass);

            actionButtonBuilder = actionButtonClass.getMethod("builder", Component.class);
            Class<?> actionButtonBuilderClass = Class.forName("io.papermc.paper.registry.data.dialog.ActionButton$Builder");
            actionButtonBuilderTooltip = actionButtonBuilderClass.getMethod("tooltip", Component.class);
            actionButtonBuilderAction = actionButtonBuilderClass.getMethod("action", dialogActionClass);
            actionButtonBuilderBuild = actionButtonBuilderClass.getMethod("build");

            dialogActionCustomClick = dialogActionClass.getMethod("customClick", dialogActionCallbackClass, clickCallbackOptionsClass);

            Class<?> optionsBuilderClass = Class.forName("net.kyori.adventure.text.event.ClickCallback$Options$Builder");
            clickCallbackOptionsBuilder = clickCallbackOptionsClass.getMethod("builder");
            clickCallbackOptionsBuilderUses = optionsBuilderClass.getMethod("uses", int.class);
            clickCallbackOptionsBuilderBuild = optionsBuilderClass.getMethod("build");

            dialogBodyPlainMessage = dialogBodyClass.getMethod("plainMessage", Component.class);
            dialogBodyItem = dialogBodyClass.getMethod("item", ItemStack.class);

            registryBuilderFactoryEmpty = registryBuilderFactoryClass.getMethod("empty");
            entryBuilderBase = dialogRegistryEntryBuilderClass.getMethod("base", dialogBaseClass);
            entryBuilderType = dialogRegistryEntryBuilderClass.getMethod("type", dialogTypeClass);

            ok = true;
        } catch (ReflectiveOperationException e) {
            ok = false;
        }
        SUPPORTED = ok;
    }

    private DialogCompat() {
    }

    public static boolean isSupported() {
        return SUPPORTED;
    }

    /** One row of the notice dialog's body: an optional icon plus its description. */
    public record Line(ItemStack icon, Component text) {
        public Line(Component text) {
            this(null, text);
        }
    }

    /**
     * Shows a Paper "notice" dialog: a title, a scrollable list of body lines
     * (each optionally paired with an item icon), and one button that runs
     * {@code onAccept} when clicked. Returns false (and shows nothing) if the
     * Dialog API isn't available or anything about the reflective call fails.
     */
    public static boolean showNotice(Player player, Component title, List<Line> lines, Component buttonText, Runnable onAccept) {
        if (!SUPPORTED) {
            return false;
        }
        try {
            List<Object> body = new ArrayList<>();
            for (Line line : lines) {
                if (line.icon() != null) {
                    body.add(dialogBodyItem.invoke(null, line.icon()));
                }
                body.add(dialogBodyPlainMessage.invoke(null, line.text()));
            }

            Object optionsBuilder = clickCallbackOptionsBuilder.invoke(null);
            optionsBuilder = clickCallbackOptionsBuilderUses.invoke(optionsBuilder, 1);
            Object options = clickCallbackOptionsBuilderBuild.invoke(optionsBuilder);

            Object callback = Proxy.newProxyInstance(
                    DialogCompat.class.getClassLoader(),
                    new Class<?>[]{dialogActionCallbackClass},
                    (InvocationHandler) (proxy, method, args) -> {
                        if (method.getName().equals("onClick") || method.getParameterCount() == 2) {
                            onAccept.run();
                        }
                        return null;
                    });
            Object action = dialogActionCustomClick.invoke(null, callback, options);

            Object buttonBuilder = actionButtonBuilder.invoke(null, buttonText);
            buttonBuilder = actionButtonBuilderAction.invoke(buttonBuilder, action);
            Object button = actionButtonBuilderBuild.invoke(buttonBuilder);

            Object dialogType = dialogTypeNotice.invoke(null, button);

            Object baseBuilder = dialogBaseBuilder.invoke(null, title);
            baseBuilder = dialogBaseBuilderBody.invoke(baseBuilder, body);
            Object base = dialogBaseBuilderBuild.invoke(baseBuilder);

            Object dialog = dialogCreate.invoke(null, (java.util.function.Consumer<Object>) factory -> {
                try {
                    Object builder = registryBuilderFactoryEmpty.invoke(factory);
                    builder = entryBuilderBase.invoke(builder, base);
                    entryBuilderType.invoke(builder, dialogType);
                } catch (ReflectiveOperationException e) {
                    LOGGER.log(Level.WARNING, "Failed to configure dialog", e);
                }
            });

            playerShowDialog.invoke(player, dialog);
            return true;
        } catch (ReflectiveOperationException | RuntimeException e) {
            LOGGER.log(Level.WARNING, "Failed to show a Paper dialog, falling back to the chest menu", e);
            return false;
        }
    }
}
