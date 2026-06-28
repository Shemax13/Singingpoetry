-- Migration 005: Add missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_audio_breakdowns_song_id ON audio_breakdowns(song_id);
CREATE INDEX IF NOT EXISTS idx_messages_forward_from_msg_id ON messages(forward_from_msg_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_msg_id ON messages(reply_to_msg_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_type ON messages(chat_type);