CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_msg_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT 'group',
  msg_type TEXT NOT NULL DEFAULT 'text',
  text_content TEXT,
  file_id TEXT,
  file_unique_id TEXT,
  file_url TEXT,
  mime_type TEXT,
  file_size INTEGER,
  duration INTEGER,
  forward_from_chat_id TEXT,
  forward_from_msg_id INTEGER,
  reply_to_msg_id INTEGER,
  reply_to_chat_id TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_chat_msg ON messages(chat_id, tg_msg_id);
CREATE INDEX IF NOT EXISTS idx_forward ON messages(forward_from_chat_id, forward_from_msg_id);
CREATE INDEX IF NOT EXISTS idx_reply ON messages(reply_to_msg_id);
CREATE INDEX IF NOT EXISTS idx_chat_type ON messages(chat_type);
