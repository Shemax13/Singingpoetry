import type { Song, AudioBreakdown, Setting, D1Database } from './types';

export function db(db: D1Database) {
  return {
    // Songs
    async getSongs(visibleOnly = true, limit = 50, offset = 0): Promise<Song[]> {
      let query = 'SELECT * FROM songs';
      const params: unknown[] = [];
      if (visibleOnly) {
        query += ' WHERE visible = 1';
      }
      query += ' ORDER BY order_index ASC, published_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      const result = await db.prepare(query).bind(...params).all<Song>();
      return result.results ?? [];
    },

    async getSong(id: number): Promise<Song | null> {
      const result = await db.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first<Song>();
      return result ?? null;
    },

    async getNextSong(currentId: number): Promise<Song | null> {
      const current = await this.getSong(currentId);
      if (!current) return null;
      const result = await db.prepare(
        'SELECT * FROM songs WHERE visible = 1 AND order_index > ? ORDER BY order_index ASC LIMIT 1'
      ).bind(current.order_index).first<Song>();
      if (result) return result;
      return db.prepare(
        'SELECT * FROM songs WHERE visible = 1 ORDER BY order_index ASC LIMIT 1'
      ).first<Song>();
    },

    async upsertSong(song: Partial<Song> & { title: string }): Promise<Song> {
      if (song.id) {
        await db.prepare(
          `UPDATE songs SET title = ?, lyrics = ?, tg_video_url = ?, suno_audio_url = ?,
           suno_cover_url = ?, suno_track_url = ?, visible = ?, language = ?,
           order_index = ?, telegram_message_id = ?, published_at = ?,
           updated_at = datetime('now')
           WHERE id = ?`
        ).bind(
          song.title, song.lyrics ?? null, song.tg_video_url ?? null,
          song.suno_audio_url ?? null, song.suno_cover_url ?? null,
          song.suno_track_url ?? null, song.visible ?? 1, song.language ?? 'ru',
          song.order_index ?? 0, song.telegram_message_id ?? null,
          song.published_at ?? null, song.id
        ).run();
        const updated = await this.getSong(song.id);
        return updated!;
      }
      const result = await db.prepare(
        `INSERT INTO songs (title, lyrics, tg_video_url, suno_audio_url, suno_cover_url,
         suno_track_url, visible, language, order_index, telegram_message_id, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        song.title, song.lyrics ?? null, song.tg_video_url ?? null,
        song.suno_audio_url ?? null, song.suno_cover_url ?? null,
        song.suno_track_url ?? null, song.visible ?? 1, song.language ?? 'ru',
        song.order_index ?? 0, song.telegram_message_id ?? null,
        song.published_at ?? null
      ).run();
      const id = result.meta.last_row_id;
      return (await this.getSong(id))!;
    },

    async deleteSong(id: number): Promise<void> {
      await db.prepare('UPDATE songs SET visible = 0 WHERE id = ?').bind(id).run();
    },

    async reorderSongs(ids: number[]): Promise<void> {
      const stmt = db.prepare('UPDATE songs SET order_index = ? WHERE id = ?');
      await db.batch(ids.map((id, idx) => stmt.bind(idx, id)));
    },

    async getSongByTelegramMsgId(msgId: number): Promise<Song | null> {
      const result = await db.prepare(
        'SELECT * FROM songs WHERE telegram_message_id = ?'
      ).bind(msgId).first<Song>();
      return result ?? null;
    },

    // Audio breakdowns
    async getAudioBreakdowns(songId?: number): Promise<AudioBreakdown[]> {
      let query = 'SELECT * FROM audio_breakdowns WHERE visible = 1';
      const params: unknown[] = [];
      if (songId) {
        query += ' AND song_id = ?';
        params.push(songId);
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.prepare(query).bind(...params).all<AudioBreakdown>();
      return result.results ?? [];
    },

    async addAudioBreakdown(ab: Omit<AudioBreakdown, 'id' | 'created_at'>): Promise<AudioBreakdown> {
      const result = await db.prepare(
        `INSERT INTO audio_breakdowns (song_id, title, file_url, duration, telegram_message_id, visible)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(ab.song_id, ab.title, ab.file_url, ab.duration, ab.telegram_message_id ?? null, ab.visible ?? 1).run();
      const id = result.meta.last_row_id;
      return (await db.prepare('SELECT * FROM audio_breakdowns WHERE id = ?').bind(id).first<AudioBreakdown>())!;
    },

    // Settings
    async getSetting(key: string): Promise<string | null> {
      const result = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<Setting>();
      return result?.value ?? null;
    },

    async setSetting(key: string, value: string): Promise<void> {
      await db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
      ).bind(key, value, value).run();
    },

    // Admin sessions
    async createSession(token: string, expiresAt: string): Promise<void> {
      await db.prepare(
        'INSERT INTO admin_sessions (id, expires_at) VALUES (?, ?)'
      ).bind(token, expiresAt).run();
    },

    async validateSession(token: string): Promise<boolean> {
      const result = await db.prepare(
        'SELECT id FROM admin_sessions WHERE id = ? AND expires_at > datetime(\'now\')'
      ).bind(token).first();
      return !!result;
    },

    async cleanSessions(): Promise<void> {
      await db.prepare(
        'DELETE FROM admin_sessions WHERE expires_at < datetime(\'now\')'
      ).run();
    },
  };
}
