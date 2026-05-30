-- Fix column-level DEFAULT for secondsToWaitAfterQueueEmpties.
-- The schema says @default(600) but all prior table rebuilds used DEFAULT 30,
-- so new Setting rows created by raw DB inserts would get 30 seconds.
-- SQLite cannot ALTER COLUMN DEFAULT, so we rebuild the table.
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
INSERT INTO "new_Setting" SELECT * FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
