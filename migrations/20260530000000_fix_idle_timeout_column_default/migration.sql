-- Fix column-level DEFAULT for secondsToWaitAfterQueueEmpties from 30 to 600.
-- SQLite cannot ALTER COLUMN DEFAULT, so the table must be rebuilt.
-- Drop staging table first in case a previous partial run left it behind.
PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS "new_Setting";
CREATE TABLE "new_Setting" (
    "guildId"                             TEXT    NOT NULL PRIMARY KEY,
    "playlistLimit"                       INTEGER NOT NULL DEFAULT 50,
    "secondsToWaitAfterQueueEmpties"      INTEGER NOT NULL DEFAULT 600,
    "leaveIfNoListeners"                  BOOLEAN NOT NULL DEFAULT true,
    "queueAddResponseEphemeral"           BOOLEAN NOT NULL DEFAULT false,
    "autoAnnounceNextSong"                BOOLEAN NOT NULL DEFAULT false,
    "defaultVolume"                       INTEGER NOT NULL DEFAULT 100,
    "defaultQueuePageSize"                INTEGER NOT NULL DEFAULT 10,
    "turnDownVolumeWhenPeopleSpeak"       BOOLEAN NOT NULL DEFAULT false,
    "turnDownVolumeWhenPeopleSpeakTarget" INTEGER NOT NULL DEFAULT 20,
    "announcementChannelId"               TEXT,
    "createdAt"                           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                           DATETIME NOT NULL
);
INSERT INTO "new_Setting" (
    "guildId", "playlistLimit", "secondsToWaitAfterQueueEmpties",
    "leaveIfNoListeners", "queueAddResponseEphemeral", "autoAnnounceNextSong",
    "defaultVolume", "defaultQueuePageSize",
    "turnDownVolumeWhenPeopleSpeak", "turnDownVolumeWhenPeopleSpeakTarget",
    "announcementChannelId", "createdAt", "updatedAt"
)
SELECT
    "guildId", "playlistLimit", "secondsToWaitAfterQueueEmpties",
    "leaveIfNoListeners", "queueAddResponseEphemeral", "autoAnnounceNextSong",
    "defaultVolume", "defaultQueuePageSize",
    "turnDownVolumeWhenPeopleSpeak", "turnDownVolumeWhenPeopleSpeakTarget",
    "announcementChannelId", "createdAt", "updatedAt"
FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
