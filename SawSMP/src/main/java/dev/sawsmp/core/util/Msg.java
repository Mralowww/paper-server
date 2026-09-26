package dev.sawsmp.core.util;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;

import java.util.ArrayList;
import java.util.List;

/** MiniMessage 訊息工具；{key} 形式的變數會被安全地當成純文字插入。 */
public final class Msg {
    private static final MiniMessage MM = MiniMessage.miniMessage();
    private static String prefix = "";

    private Msg() {}

    public static void setPrefix(String p) { prefix = p == null ? "" : p; }

    public static Component parse(String mini, String... kv) {
        List<TagResolver> rs = new ArrayList<>();
        String text = mini;
        for (int i = 0; i + 1 < kv.length; i += 2) {
            String key = "v" + i;
            text = text.replace("{" + kv[i] + "}", "<" + key + ">");
            rs.add(Placeholder.unparsed(key, kv[i + 1] == null ? "" : kv[i + 1]));
        }
        return MM.deserialize(text, TagResolver.resolver(rs));
    }

    public static void send(CommandSender to, String mini, String... kv) {
        to.sendMessage(parse(prefix + mini, kv));
    }

    public static void broadcast(String mini, String... kv) {
        Component c = parse(prefix + mini, kv);
        Bukkit.getOnlinePlayers().forEach(p -> Sched.entity(p, () -> p.sendMessage(c)));
        Bukkit.getConsoleSender().sendMessage(c);
    }

    public static void notifyStaff(String mini, String... kv) {
        Component c = parse(prefix + mini, kv);
        Bukkit.getOnlinePlayers().forEach(p -> {
            if (p.hasPermission("sawsmp.notify")) Sched.entity(p, () -> p.sendMessage(c));
        });
        Bukkit.getConsoleSender().sendMessage(c);
    }

    public static String plain(String mini) {
        return MM.stripTags(mini);
    }
}
