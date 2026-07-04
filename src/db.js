var EXTRA_AUDIO_SUBQUERY = "(SELECT file_url FROM extra_audio WHERE song_id=s.id AND file_type='podcast' AND visible=1 ORDER BY id ASC LIMIT 1)";
var EXTRA_AUDIO_COUNT_SUBQUERY = "(SELECT COUNT(*) FROM extra_audio WHERE song_id=s.id AND file_type='podcast' AND visible=1)";

export function db(e) {
  return {
    async getSongs(v, l, o) {
      l = l || 50; o = o || 0;
      var q = "SELECT s.*," + EXTRA_AUDIO_COUNT_SUBQUERY + " as podcast_count," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s";
      var p = [];
      if (v) q += " WHERE s.visible=1";
      q += " ORDER BY s.order_index ASC,s.id DESC LIMIT ? OFFSET ?";
      p.push(l, o);
      return (await e.prepare(q).bind(...p).all()).results || [];
    },
    async getSong(id) { return await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE id=?").bind(id).first() || null; },
    async getPublicSong(id) { return await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE id=? AND visible=1").bind(id).first() || null; },
    async getNextSong(id) {
      var c = await this.getSong(id);
      if (!c) return null;
      var r = await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE visible=1 AND order_index>? ORDER BY order_index ASC LIMIT 1").bind(c.order_index).first();
      return r || await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE visible=1 ORDER BY order_index ASC LIMIT 1").first();
    },
    async upsertSong(s) {
      if (s.id) {
        var cols = [], vals = [];
        var allowedCols = { title: 1, lyrics: 1, tg_video_url: 1, tg_file_id: 1, suno_audio_url: 1, suno_cover_url: 1, suno_track_url: 1, cover_url: 1, language: 1, order_index: 1, telegram_message_id: 1, published_at: 1 };
        for (var k in allowedCols) {
          if (s[k] !== undefined) {
            cols.push(k + "=?");
            vals.push(k === "language" ? (s[k] || "ru") : (s[k] === undefined || s[k] === null ? null : s[k]));
          }
        }
        if (s.visible !== undefined) { cols.push("visible=?"); vals.push(s.visible != 0 ? 1 : 0); }
        if (!cols.length) return this.getSong(s.id);
        vals.push(s.id);
        var stmt = e.prepare("UPDATE songs SET " + cols.join(",") + ",updated_at=datetime('now') WHERE id=?"); stmt.bind(...vals); await stmt.run();
        return this.getSong(s.id);
      }
      var r = await e.prepare("INSERT INTO songs(title,lyrics,tg_video_url,tg_file_id,suno_audio_url,suno_cover_url,suno_track_url,cover_url,visible,language,order_index,telegram_message_id,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(s.title, s.lyrics || null, s.tg_video_url || null, s.tg_file_id || null, s.suno_audio_url || null, s.suno_cover_url || null, s.suno_track_url || null, s.cover_url || null, 1, s.language || "ru", s.order_index || 0, s.telegram_message_id || null, s.published_at || null).run();
      return this.getSong(r.meta.last_row_id);
    },
    async deleteSong(id) {
      await e.prepare("UPDATE songs SET visible=0 WHERE id=?").bind(id).run();
      await e.prepare("UPDATE extra_audio SET visible=0 WHERE song_id=?").bind(id).run();
    },
    async getExtraAudio(songId, fileType) {
      if (fileType) return (await e.prepare("SELECT * FROM extra_audio WHERE song_id=? AND file_type=? AND visible=1 ORDER BY id ASC").bind(songId, fileType).all()).results || [];
      return (await e.prepare("SELECT * FROM extra_audio WHERE song_id=? AND visible=1 ORDER BY id ASC").bind(songId).all()).results || [];
    },
    async upsertExtraAudio(a) {
      if (a.id) {
        var cols = [], vals = [];
        var allowed = { song_id: 1, title: 1, file_url: 1, r2_key: 1, file_type: 1, source: 1, telegram_message_id: 1, duration: 1 };
        for (var k in allowed) {
          if (a[k] !== undefined) { cols.push(k + "=?"); vals.push(a[k]); }
        }
        if (a.visible !== undefined) { cols.push("visible=?"); vals.push(a.visible ? 1 : 0); }
        if (!cols.length) return null;
        vals.push(a.id);
        await e.prepare("UPDATE extra_audio SET " + cols.join(",") + ",updated_at=datetime('now') WHERE id=?").bind(...vals).run();
        return await e.prepare("SELECT * FROM extra_audio WHERE id=?").bind(a.id).first();
      }
      var r = await e.prepare("INSERT INTO extra_audio(song_id,title,file_url,r2_key,file_type,source,telegram_message_id,duration,visible) VALUES(?,?,?,?,?,?,?,?,?)").bind(a.song_id, a.title || null, a.file_url || null, a.r2_key || null, a.file_type || 'podcast', a.source || 'telegram', a.telegram_message_id || null, a.duration || null, 1).run();
      return await e.prepare("SELECT * FROM extra_audio WHERE id=?").bind(r.meta.last_row_id).first();
    },
    async deleteExtraAudio(id) { await e.prepare("UPDATE extra_audio SET visible=0 WHERE id=?").bind(id).run(); },
    async reorderSongs(ids) {
      var s = e.prepare("UPDATE songs SET order_index=? WHERE id=?");
      await e.batch(ids.map(function (id, i) { return s.bind(i, id); }));
    },
    async getByTgMsg(m) { return await e.prepare("SELECT * FROM songs WHERE telegram_message_id=?").bind(m).first() || null; },
    async createSession(t, ex) { await e.prepare("INSERT INTO admin_sessions(id,expires_at) VALUES(?,?)").bind(t, ex).run(); },
    async storeMessage(m) {
      var exists = await e.prepare("SELECT id FROM messages WHERE chat_id=? AND tg_msg_id=?").bind(m.chat_id, m.tg_msg_id).first();
      if (exists) {
        if (m.cover_file_id) await e.prepare("UPDATE messages SET cover_file_id=? WHERE id=?").bind(m.cover_file_id, exists.id).run();
        return exists.id;
      }
      var r = await e.prepare("INSERT INTO messages(tg_msg_id,chat_id,chat_type,msg_type,text_content,file_id,file_unique_id,file_url,mime_type,file_size,duration,file_name,forward_from_chat_id,forward_from_msg_id,reply_to_msg_id,reply_to_chat_id,published_at,cover_file_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(m.tg_msg_id, m.chat_id, m.chat_type, m.msg_type, m.text_content || null, m.file_id || null, m.file_unique_id || null, m.file_url || null, m.mime_type || null, m.file_size || null, m.duration || null, m.file_name || null, m.forward_from_chat_id || null, m.forward_from_msg_id || null, m.reply_to_msg_id || null, m.reply_to_chat_id || null, m.published_at || null, m.cover_file_id || null).run();
      return r.meta.last_row_id;
    },
    async getMessages(chatType, l, o) {
      l = l || 100; o = o || 0;
      if (chatType) return (await e.prepare("SELECT * FROM messages WHERE chat_type=? ORDER BY published_at DESC LIMIT ? OFFSET ?").bind(chatType, l, o).all()).results || [];
      return (await e.prepare("SELECT * FROM messages ORDER BY published_at DESC LIMIT ? OFFSET ?").bind(l, o).all()).results || [];
    },
    async getMessageByChatAndMsg(chatId, msgId) { return await e.prepare("SELECT * FROM messages WHERE chat_id=? AND tg_msg_id=?").bind(chatId, msgId).first() || null; },
    async getPublications() {
      var rows = await e.prepare("SELECT * FROM messages WHERE forward_from_chat_id IS NOT NULL AND forward_from_msg_id IS NOT NULL ORDER BY published_at ASC LIMIT 500").all();
      var unique = []; var seen = {};
      for (var i = 0; i < (rows.results || []).length; i++) {
        var msg = rows.results[i];
        var chanId = msg.forward_from_msg_id;
        if (seen[chanId]) continue;
        seen[chanId] = true;
        unique.push({ msg: msg, chanId: chanId });
      }
      var tgIds = unique.map(function (x) { return x.msg.tg_msg_id; });
      var commentsByReply = {};
      if (tgIds.length) {
        var placeholders = tgIds.map(function () { return '?'; }).join(',');
        var allComments = await e.prepare("SELECT * FROM messages WHERE chat_type='group' AND reply_to_msg_id IN (" + placeholders + ") ORDER BY published_at ASC").bind(...tgIds).all();
        for (var ci = 0; ci < (allComments.results || []).length; ci++) {
          var c = allComments.results[ci];
          if (!commentsByReply[c.reply_to_msg_id]) commentsByReply[c.reply_to_msg_id] = [];
          commentsByReply[c.reply_to_msg_id].push(c);
        }
      }
      var chanIds = unique.map(function (x) { return x.chanId; });
      var songsByMsgId = {};
      if (chanIds.length) {
        var placeholders = chanIds.map(function () { return '?'; }).join(',');
        var allSongs = await e.prepare("SELECT id,title,suno_audio_url,suno_cover_url,suno_track_url,cover_url,telegram_message_id FROM songs WHERE telegram_message_id IN (" + placeholders + ")").bind(...chanIds).all();
        for (var si = 0; si < (allSongs.results || []).length; si++) {
          var s = allSongs.results[si];
          songsByMsgId[s.telegram_message_id] = s;
        }
      }
      var results = [];
      for (var ui = 0; ui < unique.length; ui++) {
        var msg = unique[ui].msg;
        var chanId = unique[ui].chanId;
        var post = { channel_msg_id: chanId, group_msg_id: msg.tg_msg_id, text_content: msg.text_content, msg_type: msg.msg_type, file_id: msg.file_id, file_unique_id: msg.file_unique_id, file_url: msg.file_url, mime_type: msg.mime_type, file_size: msg.file_size, duration: msg.duration, published_at: msg.published_at, cover_url: msg.cover_url || null };
        results.push({ post: post, comments: commentsByReply[msg.tg_msg_id] || [], song: songsByMsgId[chanId] || null });
      }
      return results;
    },
    async getMessageStats() {
      var total = await e.prepare("SELECT COUNT(*) as c FROM messages").first();
      var fromChannel = await e.prepare("SELECT COUNT(DISTINCT forward_from_msg_id) as c FROM messages WHERE forward_from_chat_id IS NOT NULL").first();
      var groups = await e.prepare("SELECT COUNT(*) as c FROM messages WHERE chat_type='group'").first();
      var withMedia = await e.prepare("SELECT COUNT(*) as c FROM messages WHERE file_id IS NOT NULL").first();
      return { total: total.c, channelPosts: fromChannel.c, groupMsgs: groups.c, withMedia: withMedia.c };
    },
    async getChannelMsgCount() {
      var r = await e.prepare("SELECT COUNT(DISTINCT forward_from_msg_id) as c FROM messages WHERE forward_from_chat_id IS NOT NULL").first();
      return r ? r.c : 0;
    },
    // Metadata reviews
    async createMetadataReview(songId, field, oldVal, newVal, source) {
      var r = await e.prepare("INSERT INTO metadata_reviews(song_id,field,old_value,new_value,source) VALUES(?,?,?,?,?)").bind(songId, field, oldVal, newVal, source || 'suno').run();
      return r.meta.last_row_id;
    },
    async getPendingReviews() {
      return (await e.prepare("SELECT mr.*,s.title as song_title FROM metadata_reviews mr LEFT JOIN songs s ON s.id=mr.song_id WHERE mr.status='pending' ORDER BY mr.created_at DESC LIMIT 200").all()).results || [];
    },
    async resolveReview(id, status) {
      if (status !== 'approved' && status !== 'rejected') return;
      var review = await e.prepare("SELECT * FROM metadata_reviews WHERE id=?").bind(id).first();
      if (!review) return;
      if (status === 'approved') {
        var col = review.field;
        if (['title', 'lyrics', 'suno_audio_url', 'suno_cover_url', 'suno_track_url', 'cover_url', 'language'].indexOf(col) !== -1) {
          await e.prepare("UPDATE songs SET " + col + "=?,updated_at=datetime('now') WHERE id=?").bind(review.new_value, review.song_id).run();
        }
      }
      await e.prepare("UPDATE metadata_reviews SET status=? WHERE id=?").bind(status, id).run();
    },
    // External link types
    async getLinkTypes() {
      return (await e.prepare("SELECT * FROM external_link_types ORDER BY sort_order ASC,id ASC").all()).results || [];
    },
    async upsertLinkType(t) {
      if (t.id) {
        await e.prepare("UPDATE external_link_types SET name=?,icon=?,sort_order=? WHERE id=?").bind(t.name, t.icon || '🔗', t.sort_order || 0, t.id).run();
        return await e.prepare("SELECT * FROM external_link_types WHERE id=?").bind(t.id).first();
      }
      var r = await e.prepare("INSERT INTO external_link_types(name,icon,sort_order) VALUES(?,?,?)").bind(t.name, t.icon || '🔗', t.sort_order || 0).run();
      return await e.prepare("SELECT * FROM external_link_types WHERE id=?").bind(r.meta.last_row_id).first();
    },
    async deleteLinkType(id) { await e.prepare("DELETE FROM external_link_types WHERE id=?").bind(id).run(); },
    // Song external links
    async getSongExternalLinks(songId) {
      return (await e.prepare("SELECT sl.*,lt.name as link_type_name,lt.icon as link_type_icon FROM song_external_links sl LEFT JOIN external_link_types lt ON lt.id=sl.link_type_id WHERE sl.song_id=? ORDER BY lt.sort_order ASC,sl.id ASC").bind(songId).all()).results || [];
    },
    async getSongLink(id) { return await e.prepare("SELECT * FROM song_external_links WHERE id=?").bind(id).first() || null; },
    async upsertSongLink(l) {
      if (l.id) {
        await e.prepare("UPDATE song_external_links SET url=?,description=? WHERE id=?").bind(l.url, l.description || null, l.id).run();
        return await e.prepare("SELECT * FROM song_external_links WHERE id=?").bind(l.id).first();
      }
      var r = await e.prepare("INSERT INTO song_external_links(song_id,link_type_id,url,description) VALUES(?,?,?,?)").bind(l.song_id, l.link_type_id, l.url, l.description || null).run();
      return await e.prepare("SELECT * FROM song_external_links WHERE id=?").bind(r.meta.last_row_id).first();
    },
    async deleteSongLink(id) { await e.prepare("DELETE FROM song_external_links WHERE id=?").bind(id).run(); },
  };
}
