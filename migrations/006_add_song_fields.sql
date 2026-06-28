-- Migration 006: Add new fields to songs table
ALTER TABLE songs ADD COLUMN suno_title TEXT;
ALTER TABLE songs ADD COLUMN description TEXT;
ALTER TABLE songs ADD COLUMN r2_video_url TEXT;
ALTER TABLE songs ADD COLUMN r2_migratable INTEGER DEFAULT 1;
ALTER TABLE songs ADD COLUMN pending_review INTEGER DEFAULT 0;
ALTER TABLE songs ADD COLUMN pending_metadata TEXT;
ALTER TABLE songs ADD COLUMN metadata_source TEXT DEFAULT 'telegram';

CREATE INDEX IF NOT EXISTS idx_songs_visible_title ON songs(visible, title);
