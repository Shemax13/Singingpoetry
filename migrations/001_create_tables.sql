-- Migration 001: Create initial tables
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_message_id INTEGER UNIQUE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  lyrics TEXT,
  tg_video_url TEXT,
  suno_audio_url TEXT,
  suno_cover_url TEXT,
  suno_track_url TEXT,
  published_at TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  language TEXT NOT NULL DEFAULT 'ru',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audio_breakdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL,
  duration INTEGER DEFAULT 0,
  telegram_message_id INTEGER,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_language', 'ru');
INSERT OR IGNORE INTO settings (key, value) VALUES ('songs_per_page', '20');
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_sync_at', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('about_text_ru', 'Поэтический проект Shemaxpoetry');
INSERT OR IGNORE INTO settings (key, value) VALUES ('about_text_en', 'Shemaxpoetry poetic project');
