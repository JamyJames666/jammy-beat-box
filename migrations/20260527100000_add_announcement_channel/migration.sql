-- Add optional announcementChannelId to Setting.
-- NULL means "use default discovery logic" (channel named musicbot → system channel → first writable).
ALTER TABLE "Setting" ADD COLUMN "announcementChannelId" TEXT;
