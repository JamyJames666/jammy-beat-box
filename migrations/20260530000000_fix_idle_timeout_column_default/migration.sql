-- Fix column-level DEFAULT for secondsToWaitAfterQueueEmpties from 30 to 600.
-- SQLite cannot ALTER COLUMN DEFAULT, so the table must be rebuilt.
-- Explicit column list in INSERT avoids positional mismatch from prior
-- ALTER TABLE ADD COLUMN migrations which append columns at the end.
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "playlistLimit" INTEGER NOT NULL DEFAULT 50,
    "secondsToWaitAfterQueueEmpties" INTEGER NOT NULL DEFAULT 600,
    "leaveIfNoListeners" BOOLEAN NOT NULL DEFAULT true,
    "autoAnnounceNextSong" BOOLEAN NOT NULL DEFAULT false,
    "announcementChannelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" (
    "guildId", "playlistLimit", "secondsToWaitAfterQueueEmpties",
    "leaveIfNoListeners", "autoAnnounceNextSong", "announcementChannelId",
    "createdAt", "updatedAt"
)
SELECT
    "guildId", "playlistLimit", "secondsToWaitAfterQueueEmpties",
    "leaveIfNoListeners", "autoAnnounceNextSong", "announcementChannelId",
    "createdAt", "updatedAt"
FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
