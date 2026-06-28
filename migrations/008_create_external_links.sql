-- Migration 008: Create external link types and song external links tables
CREATE TABLE IF NOT EXISTS external_link_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '🔗',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS song_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  link_type_id INTEGER NOT NULL REFERENCES external_link_types(id),
  url TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_song_external_links_song_id ON song_external_links(song_id);

-- Pre-populated link types
INSERT INTO external_link_types (name, icon, sort_order) VALUES
  ('Instagram', '📷', 1),
  ('TikTok', '🎵', 2),
  ('VK', '💬', 3);
