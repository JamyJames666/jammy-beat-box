-- Increase the default idle-disconnect timeout from 30 s to 600 s (10 min).
-- Only updates guilds that still have the old 30 s default; custom values are kept.
UPDATE "Setting" SET "secondsToWaitAfterQueueEmpties" = 600 WHERE "secondsToWaitAfterQueueEmpties" = 30;
