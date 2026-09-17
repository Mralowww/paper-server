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
package dev.noah.perplayerkit.storage;

import dev.noah.perplayerkit.storage.exceptions.StorageOperationException;

import java.nio.file.Path;

/**
 * Implemented by storage backends that can write a consistent snapshot of
 * themselves while the server is running, so backups do not have to copy live
 * files out from under the database engine.
 */
public interface BackupCapable {

    /**
     * @return true if this backend can currently produce a snapshot via
     *         {@link #backupTo(Path)}
     */
    boolean supportsNativeBackup();

    /**
     * Write a consistent snapshot of the storage to the given path. The snapshot
     * is self-contained: no sidecar files need to be copied alongside it.
     *
     * @param target file to write the snapshot to; overwritten if it exists
     */
    void backupTo(Path target) throws StorageOperationException;
}
