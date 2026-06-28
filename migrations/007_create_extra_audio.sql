-- Migration 007: Create extra_audio table and migrate data from audio_breakdowns
CREATE TABLE IF NOT EXISTS extra_audio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  title TEXT,
  file_url TEXT,
  r2_key TEXT,
  file_type TEXT DEFAULT 'podcast',
  source TEXT DEFAULT 'telegram',
  telegram_message_id INTEGER,
  duration INTEGER,
  visible INTEGER DEFAULT 1,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_extra_audio_song_id ON extra_audio(song_id);
CREATE INDEX IF NOT EXISTS idx_extra_audio_visible ON extra_audio(visible);

-- Migrate existing data from audio_breakdowns
INSERT INTO extra_audio (song_id, title, file_url, file_type, duration, visible, telegram_message_id, created_at)
SELECT song_id, title, file_url, 'podcast', duration, visible, telegram_message_id, created_at
FROM audio_breakdowns;

-- Drop old table
DROP TABLE IF EXISTS audio_breakdowns;
