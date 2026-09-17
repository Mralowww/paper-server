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
package dev.noah.perplayerkit.anvil;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * One outstanding "type the new name in chat" request per player. The rename
 * button registers a callback here and closes the GUI; the chat listener
 * intercepts the player's next message, cancels it so it never reaches public
 * chat, and hands the raw text to the callback.
 */
public final class RenamePrompt {

    private static final Map<UUID, Consumer<String>> pending = new ConcurrentHashMap<>();

    private RenamePrompt() {
    }

    public static void await(UUID player, Consumer<String> onSubmit) {
        pending.put(player, onSubmit);
    }

    public static boolean isAwaiting(UUID player) {
        return pending.containsKey(player);
    }

    public static void cancel(UUID player) {
        pending.remove(player);
    }

    /** Consumes and runs the pending callback for this player, if any. */
    public static boolean submit(UUID player, String text) {
        Consumer<String> callback = pending.remove(player);
        if (callback == null) {
            return false;
        }
        callback.accept(text);
        return true;
    }
}
