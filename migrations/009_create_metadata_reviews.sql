-- Migration 009: Create metadata reviews table for tracking Suno metadata changes
CREATE TABLE IF NOT EXISTS metadata_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT DEFAULT 'suno',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metadata_reviews_song_id ON metadata_reviews(song_id);
CREATE INDEX IF NOT EXISTS idx_metadata_reviews_status ON metadata_reviews(status);
