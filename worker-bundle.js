// src/utils.js
async function safeJSON(req) {
  try {
    return await req.json();
  } catch (e) {
    return null;
  }
}
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400"
};
var corsRestricted = {
  "Access-Control-Allow-Origin": "https://poetry.shemaxpoetry.workers.dev",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400"
};
var secureHeaders = {
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https://api.telegram.org https://cdn1.suno.ai https://cdn2.suno.ai https://raw.githubusercontent.com data:; media-src 'self' https://api.telegram.org https://cdn1.suno.ai https://cdn2.suno.ai https://raw.githubusercontent.com; connect-src 'self' https://api.telegram.org https://cdn1.suno.ai https://raw.githubusercontent.com; font-src 'self'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload"
};
function json(d, s) {
  return new Response(JSON.stringify(d), { status: s || 200, headers: Object.assign({}, cors, { "Content-Type": "application/json" }, secureHeaders) });
}
function err(s, c) {
  return json({ ok: false, error: s }, c || 500);
}
function htmlResponse(body, s) {
  return new Response(body, { status: s || 200, headers: Object.assign({ "Content-Type": "text/html; charset=utf-8" }, secureHeaders) });
}
var rateLimitStore = {};
var RATE_LIMIT_WINDOW = 6e4;
function rateLimit(key, maxRequests, windowMs) {
  windowMs = windowMs || RATE_LIMIT_WINDOW;
  var now = Date.now();
  if (!rateLimitStore[key]) rateLimitStore[key] = [];
  var entries = rateLimitStore[key];
  while (entries.length && entries[0] < now - windowMs) entries.shift();
  if (entries.length >= maxRequests) return true;
  entries.push(now);
  return false;
}
function rateLimitResponse(key, maxRequests, windowMs) {
  if (rateLimit(key, maxRequests, windowMs)) {
    return err("Too many requests. Try again later.", 429);
  }
  return null;
}
function secureJSON(d, s) {
  return new Response(JSON.stringify(d), { status: s || 200, headers: Object.assign({}, corsRestricted, { "Content-Type": "application/json" }, secureHeaders) });
}
function genToken() {
  var b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map(function(x) {
    return x.toString(16).padStart(2, "0");
  }).join("");
}
function safeInt(v, d) {
  var n = parseInt(v, 10);
  return isNaN(n) ? d : n;
}
async function isAuth(req, DB) {
  var h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return false;
  return !!await DB.prepare("SELECT id FROM admin_sessions WHERE id=? AND expires_at>datetime('now')").bind(h.slice(7)).first();
}
function sunoExtractUrls(text) {
  if (!text) return [];
  var urls = [];
  var re = /(?:https?:\/\/)?(?:www\.)?suno\.com\/(?:s|song)\/([a-zA-Z0-9]+(?:-[a-f0-9-]+)?)/gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    var id = m[1];
    var url = id.includes("-") ? "https://suno.com/song/" + id : "https://suno.com/s/" + id;
    if (urls.indexOf(url) === -1) urls.push(url);
  }
  return urls;
}
var sunoFetchCache = /* @__PURE__ */ new Map();
var SUNO_CACHE_TTL = 36e5;
async function sunoFetch(url) {
  var cached = sunoFetchCache.get(url);
  if (cached && Date.now() - cached.ts < SUNO_CACHE_TTL) return cached.data;
  var resp = await fetch("https://opensuno.vercel.app/track?url=" + encodeURIComponent(url));
  if (resp.status === 429) throw new Error("Rate limited by opensuno (20/min)");
  var data = await resp.json();
  if (data.status !== "ok" || !data.data) throw new Error(data.message || "opensuno fetch failed");
  var result = {
    title: data.data.title || "Untitled",
    audioUrl: data.data.mp3_url || null,
    coverUrl: data.data.cover_url || null,
    duration: data.data.duration || null,
    trackUrl: url
  };
  sunoFetchCache.set(url, { ts: Date.now(), data: result });
  return result;
}
async function processSunoUrl(url) {
  try {
    var info = await sunoFetch(url);
    if (!info.audioUrl) return null;
    return info;
  } catch (e) {
    return null;
  }
}
function parseMsgFull(update) {
  if (!update) return null;
  var m = update.message || update.channel_post || update;
  if (!m || !m.message_id) return null;
  var chat = m.chat;
  var chatId = chat.username ? "@" + chat.username : "" + chat.id;
  var chatType = chat.type;
  var text = m.text || m.caption || "";
  var published = new Date((m.date || 0) * 1e3).toISOString();
  var result = {
    tg_msg_id: m.message_id,
    chat_id: chatId,
    chat_type: chatType,
    msg_type: "text",
    text_content: text || null,
    file_id: null,
    file_unique_id: null,
    file_url: null,
    mime_type: null,
    file_size: null,
    duration: null,
    file_name: null,
    forward_from_chat_id: null,
    forward_from_msg_id: null,
    reply_to_msg_id: null,
    reply_to_chat_id: null,
    published_at: published
  };
  if (m.forward_from_chat && m.forward_from_message_id) {
    result.forward_from_chat_id = m.forward_from_chat.username ? "@" + m.forward_from_chat.username : "" + m.forward_from_chat.id;
    result.forward_from_msg_id = m.forward_from_message_id;
  }
  if (m.reply_to_message) {
    result.reply_to_msg_id = m.reply_to_message.message_id;
    if (m.reply_to_message.chat) result.reply_to_chat_id = m.reply_to_message.chat.username ? "@" + m.reply_to_message.chat.username : "" + m.reply_to_message.chat.id;
  }
  if (m.video) {
    result.msg_type = "video";
    result.file_id = m.video.file_id;
    result.file_unique_id = m.video.file_unique_id;
    result.mime_type = m.video.mime_type || null;
    result.file_size = m.video.file_size || null;
    result.duration = m.video.duration || null;
  } else if (m.audio) {
    result.msg_type = "audio";
    result.file_id = m.audio.file_id;
    result.file_unique_id = m.audio.file_unique_id;
    result.mime_type = m.audio.mime_type || "audio/mpeg";
    result.file_size = m.audio.file_size || null;
    result.duration = m.audio.duration || null;
    result.file_name = m.audio.file_name || null;
  } else if (m.voice) {
    result.msg_type = "voice";
    result.file_id = m.voice.file_id;
    result.file_unique_id = m.voice.file_unique_id;
    result.mime_type = m.voice.mime_type || "audio/ogg";
    result.file_size = m.voice.file_size || null;
    result.duration = m.voice.duration || null;
  } else if (m.photo && m.photo.length) {
    result.msg_type = "photo";
    var best = m.photo[m.photo.length - 1];
    result.file_id = best.file_id;
    result.file_unique_id = best.file_unique_id;
    result.file_size = best.file_size || null;
  } else if (m.document) {
    result.msg_type = "document";
    result.file_id = m.document.file_id;
    result.file_unique_id = m.document.file_unique_id;
    result.mime_type = m.document.mime_type || null;
    result.file_size = m.document.file_size || null;
  }
  return result;
}
var mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject"
};

// src/db.js
var EXTRA_AUDIO_SUBQUERY = "(SELECT file_url FROM extra_audio WHERE song_id=s.id AND file_type='podcast' AND visible=1 ORDER BY id ASC LIMIT 1)";
var EXTRA_AUDIO_COUNT_SUBQUERY = "(SELECT COUNT(*) FROM extra_audio WHERE song_id=s.id AND file_type='podcast' AND visible=1)";
function db(e) {
  return {
    async getSongs(v, l, o) {
      l = l || 50;
      o = o || 0;
      var q = "SELECT s.*," + EXTRA_AUDIO_COUNT_SUBQUERY + " as podcast_count," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s";
      var p = [];
      if (v) q += " WHERE s.visible=1";
      q += " ORDER BY s.order_index ASC,s.id DESC LIMIT ? OFFSET ?";
      p.push(l, o);
      return (await e.prepare(q).bind(...p).all()).results || [];
    },
    async getSongsCount(v) {
      var r = await e.prepare("SELECT COUNT(*) as c FROM songs" + (v ? " WHERE visible=1" : "")).first();
      return r ? r.c : 0;
    },
    async getSong(id) {
      return await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE id=?").bind(id).first() || null;
    },
    async getPublicSong(id) {
      return await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE id=? AND visible=1").bind(id).first() || null;
    },
    async getNextSong(id) {
      var c = await this.getSong(id);
      if (!c) return null;
      var r = await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE visible=1 AND order_index>? ORDER BY order_index ASC LIMIT 1").bind(c.order_index).first();
      return r || await e.prepare("SELECT s.*," + EXTRA_AUDIO_SUBQUERY + " as podcast_audio_url FROM songs s WHERE visible=1 ORDER BY order_index ASC LIMIT 1").first();
    },
    async upsertSong(s) {
      if (s.id) {
        var cols = [], vals = [];
        var allowedCols = { title: 1, lyrics: 1, tg_video_url: 1, tg_file_id: 1, tg_message_url: 1, suno_audio_url: 1, suno_cover_url: 1, suno_track_url: 1, cover_url: 1, language: 1, order_index: 1, telegram_message_id: 1, published_at: 1 };
        for (var k in allowedCols) {
          if (s[k] !== void 0) {
            cols.push(k + "=?");
            vals.push(k === "language" ? s[k] || "ru" : s[k] === void 0 || s[k] === null ? null : s[k]);
          }
        }
        if (s.visible !== void 0) {
          cols.push("visible=?");
          vals.push(s.visible != 0 ? 1 : 0);
        }
        if (!cols.length) return this.getSong(s.id);
        vals.push(s.id);
        var stmt = e.prepare("UPDATE songs SET " + cols.join(",") + ",updated_at=datetime('now') WHERE id=?");
        stmt.bind(...vals);
        await stmt.run();
        return this.getSong(s.id);
      }
      var r = await e.prepare("INSERT INTO songs(title,lyrics,tg_video_url,tg_file_id,tg_message_url,suno_audio_url,suno_cover_url,suno_track_url,cover_url,visible,language,order_index,telegram_message_id,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(s.title, s.lyrics || null, s.tg_video_url || null, s.tg_file_id || null, s.tg_message_url || null, s.suno_audio_url || null, s.suno_cover_url || null, s.suno_track_url || null, s.cover_url || null, 1, s.language || "ru", s.order_index || 0, s.telegram_message_id || null, s.published_at || null).run();
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
          if (a[k] !== void 0) {
            cols.push(k + "=?");
            vals.push(a[k]);
          }
        }
        if (a.visible !== void 0) {
          cols.push("visible=?");
          vals.push(a.visible ? 1 : 0);
        }
        if (!cols.length) return null;
        vals.push(a.id);
        await e.prepare("UPDATE extra_audio SET " + cols.join(",") + ",updated_at=datetime('now') WHERE id=?").bind(...vals).run();
        return await e.prepare("SELECT * FROM extra_audio WHERE id=?").bind(a.id).first();
      }
      var r = await e.prepare("INSERT INTO extra_audio(song_id,title,file_url,r2_key,file_type,source,telegram_message_id,duration,visible) VALUES(?,?,?,?,?,?,?,?,?)").bind(a.song_id, a.title || null, a.file_url || null, a.r2_key || null, a.file_type || "podcast", a.source || "telegram", a.telegram_message_id || null, a.duration || null, 1).run();
      return await e.prepare("SELECT * FROM extra_audio WHERE id=?").bind(r.meta.last_row_id).first();
    },
    async deleteExtraAudio(id) {
      await e.prepare("UPDATE extra_audio SET visible=0 WHERE id=?").bind(id).run();
    },
    async reorderSongs(ids) {
      var s = e.prepare("UPDATE songs SET order_index=? WHERE id=?");
      await e.batch(ids.map(function(id, i) {
        return s.bind(i, id);
      }));
    },
    async getByTgMsg(m) {
      return await e.prepare("SELECT * FROM songs WHERE telegram_message_id=?").bind(m).first() || null;
    },
    async createSession(t, ex) {
      await e.prepare("INSERT INTO admin_sessions(id,expires_at) VALUES(?,?)").bind(t, ex).run();
    },
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
      l = l || 100;
      o = o || 0;
      if (chatType) return (await e.prepare("SELECT * FROM messages WHERE chat_type=? ORDER BY published_at DESC LIMIT ? OFFSET ?").bind(chatType, l, o).all()).results || [];
      return (await e.prepare("SELECT * FROM messages ORDER BY published_at DESC LIMIT ? OFFSET ?").bind(l, o).all()).results || [];
    },
    async getMessageByChatAndMsg(chatId, msgId) {
      return await e.prepare("SELECT * FROM messages WHERE chat_id=? AND tg_msg_id=?").bind(chatId, msgId).first() || null;
    },
    async getPublications() {
      var rows = await e.prepare("SELECT * FROM messages WHERE forward_from_chat_id IS NOT NULL AND forward_from_msg_id IS NOT NULL ORDER BY published_at ASC LIMIT 500").all();
      var unique = [];
      var seen = {};
      for (var i = 0; i < (rows.results || []).length; i++) {
        var msg = rows.results[i];
        var chanId = msg.forward_from_msg_id;
        if (seen[chanId]) continue;
        seen[chanId] = true;
        unique.push({ msg, chanId });
      }
      var tgIds = unique.map(function(x) {
        return x.msg.tg_msg_id;
      });
      var commentsByReply = {};
      if (tgIds.length) {
        var placeholders = tgIds.map(function() {
          return "?";
        }).join(",");
        var allComments = await e.prepare("SELECT * FROM messages WHERE chat_type='group' AND reply_to_msg_id IN (" + placeholders + ") ORDER BY published_at ASC").bind(...tgIds).all();
        for (var ci = 0; ci < (allComments.results || []).length; ci++) {
          var c = allComments.results[ci];
          if (!commentsByReply[c.reply_to_msg_id]) commentsByReply[c.reply_to_msg_id] = [];
          commentsByReply[c.reply_to_msg_id].push(c);
        }
      }
      var chanIds = unique.map(function(x) {
        return x.chanId;
      });
      var songsByMsgId = {};
      if (chanIds.length) {
        var placeholders = chanIds.map(function() {
          return "?";
        }).join(",");
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
        results.push({ post, comments: commentsByReply[msg.tg_msg_id] || [], song: songsByMsgId[chanId] || null });
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
      var r = await e.prepare("INSERT INTO metadata_reviews(song_id,field,old_value,new_value,source) VALUES(?,?,?,?,?)").bind(songId, field, oldVal, newVal, source || "suno").run();
      return r.meta.last_row_id;
    },
    async getPendingReviews() {
      return (await e.prepare("SELECT mr.*,s.title as song_title FROM metadata_reviews mr LEFT JOIN songs s ON s.id=mr.song_id WHERE mr.status='pending' ORDER BY mr.created_at DESC LIMIT 200").all()).results || [];
    },
    async resolveReview(id, status) {
      if (status !== "approved" && status !== "rejected") return;
      var review = await e.prepare("SELECT * FROM metadata_reviews WHERE id=?").bind(id).first();
      if (!review) return;
      if (status === "approved") {
        var col = review.field;
        if (["title", "lyrics", "suno_audio_url", "suno_cover_url", "suno_track_url", "cover_url", "language"].indexOf(col) !== -1) {
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
        await e.prepare("UPDATE external_link_types SET name=?,icon=?,sort_order=? WHERE id=?").bind(t.name, t.icon || "\u{1F517}", t.sort_order || 0, t.id).run();
        return await e.prepare("SELECT * FROM external_link_types WHERE id=?").bind(t.id).first();
      }
      var r = await e.prepare("INSERT INTO external_link_types(name,icon,sort_order) VALUES(?,?,?)").bind(t.name, t.icon || "\u{1F517}", t.sort_order || 0).run();
      return await e.prepare("SELECT * FROM external_link_types WHERE id=?").bind(r.meta.last_row_id).first();
    },
    async deleteLinkType(id) {
      await e.prepare("DELETE FROM external_link_types WHERE id=?").bind(id).run();
    },
    // Song external links
    async getSongExternalLinks(songId) {
      return (await e.prepare("SELECT sl.*,lt.name as link_type_name,lt.icon as link_type_icon FROM song_external_links sl LEFT JOIN external_link_types lt ON lt.id=sl.link_type_id WHERE sl.song_id=? ORDER BY lt.sort_order ASC,sl.id ASC").bind(songId).all()).results || [];
    },
    async getSongLink(id) {
      return await e.prepare("SELECT * FROM song_external_links WHERE id=?").bind(id).first() || null;
    },
    async upsertSongLink(l) {
      if (l.id) {
        await e.prepare("UPDATE song_external_links SET url=?,description=? WHERE id=?").bind(l.url, l.description || null, l.id).run();
        return await e.prepare("SELECT * FROM song_external_links WHERE id=?").bind(l.id).first();
      }
      var r = await e.prepare("INSERT INTO song_external_links(song_id,link_type_id,url,description) VALUES(?,?,?,?)").bind(l.song_id, l.link_type_id, l.url, l.description || null).run();
      return await e.prepare("SELECT * FROM song_external_links WHERE id=?").bind(r.meta.last_row_id).first();
    },
    async deleteSongLink(id) {
      await e.prepare("DELETE FROM song_external_links WHERE id=?").bind(id).run();
    }
  };
}

// src/services.js
function cappedMap(maxSize) {
  var m = /* @__PURE__ */ new Map();
  var _set = m.set.bind(m);
  m.set = function(k, v) {
    if (m.has(k)) {
      _set(k, v);
      return;
    }
    if (m.size >= maxSize) {
      var first = m.keys().next().value;
      m.delete(first);
    }
    _set(k, v);
  };
  return m;
}
var mediaCache = cappedMap(500);
var CACHE_TTL = 6e5;
function tg(token, kv) {
  var base = "https://api.telegram.org/bot" + token;
  return {
    async getFile(fid) {
      var cached = mediaCache.get(fid);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        if (cached._fail) throw new Error("TG");
        return cached.result;
      }
      if (kv) {
        try {
          var kvRaw = await kv.get("getfile:" + fid, { type: "json" });
          if (kvRaw && Date.now() - kvRaw.ts < CACHE_TTL) {
            mediaCache.set(fid, kvRaw);
            if (kvRaw._fail) throw new Error("TG");
            return kvRaw.result;
          }
        } catch (e) {
        }
      }
      var ac = new AbortController();
      var t = setTimeout(function() {
        ac.abort();
      }, 15e3);
      try {
        var r = await (await fetch(base + "/getFile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fid }), signal: ac.signal })).json();
        if (!r.ok) {
          var failEntry = { result: null, ts: Date.now(), _fail: true };
          mediaCache.set(fid, failEntry);
          if (kv) kv.put("getfile:" + fid, JSON.stringify(failEntry)).catch(function(e) {
            console.error("KV put failEntry failed", e);
          });
          throw new Error("TG");
        }
        var entry = { result: r.result, ts: Date.now() };
        mediaCache.set(fid, entry);
        if (kv) kv.put("getfile:" + fid, JSON.stringify(entry)).catch(function(e) {
          console.error("KV put entry failed", e);
        });
        return r.result;
      } finally {
        clearTimeout(t);
      }
    },
    getFileUrl(p) {
      return "https://api.telegram.org/file/bot" + token + "/" + p;
    }
  };
}

// src/worker.js
var secureHeaders2 = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload"
};
function addSecurityHeaders(resp) {
  for (var k in secureHeaders2) resp.headers.set(k, secureHeaders2[k]);
  return resp;
}
var PRIVACY_HTML = '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Shemaxpoetry \u2014 \u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438</title><style>body{font-family:sans-serif;background:#0d0d14;color:#e8e6e3;max-width:720px;margin:0 auto;padding:40px 20px;line-height:1.6}h1{color:#d4a853}h2{color:#d4a853;font-size:1.2rem;margin-top:24px}a{color:#d4a853}</style></head><body><h1>\u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438</h1><p>\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435: 6 \u0438\u044E\u043B\u044F 2026</p><h2>1. \u041A\u0430\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043C\u044B \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u043C</h2><p>\u2014 \u0422\u0435\u043A\u0441\u0442\u044B \u0438 \u043C\u0435\u0434\u0438\u0430\u0444\u0430\u0439\u043B\u044B (\u0432\u0438\u0434\u0435\u043E, \u0430\u0443\u0434\u0438\u043E, \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F) \u0438\u0437 Telegram-\u043A\u0430\u043D\u0430\u043B\u0430 @shemaxpoetry \u0438 \u0441\u0432\u044F\u0437\u0430\u043D\u043D\u043E\u0433\u043E \u0447\u0430\u0442\u0430.<br>\u2014 IP-\u0430\u0434\u0440\u0435\u0441 \u043F\u0440\u0438 \u0437\u0430\u043F\u0440\u043E\u0441\u0430\u0445 \u043A \u0441\u0430\u0439\u0442\u0443 (\u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043E\u0439 Cloudflare).<br>\u2014 \u0414\u0430\u043D\u043D\u044B\u0435 \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u0430 \u0432 \u0430\u0434\u043C\u0438\u043D-\u043F\u0430\u043D\u0435\u043B\u044C (\u043F\u0430\u0440\u043E\u043B\u044C, Turnstile-\u0442\u043E\u043A\u0435\u043D) \u2014 \u043D\u0435 \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438.</p><h2>2. \u041A\u0430\u043A \u043C\u044B \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u043C \u0434\u0430\u043D\u043D\u044B\u0435</h2><p>\u2014 \u0414\u043B\u044F \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F \u043F\u0435\u0441\u0435\u043D, \u043F\u043E\u0434\u043A\u0430\u0441\u0442\u043E\u0432 \u0438 \u0441\u043E\u043F\u0443\u0442\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0433\u043E \u043A\u043E\u043D\u0442\u0435\u043D\u0442\u0430 \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 poetry.shemaxpoetry.workers.dev.<br>\u2014 \u0414\u043B\u044F \u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0435\u043D\u0438\u044F \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438 (rate limiting, \u0437\u0430\u0449\u0438\u0442\u0430 \u043E\u0442 \u0431\u043E\u0442\u043E\u0432).</p><h2>3. \u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0445</h2><p>\u2014 \u0414\u0430\u043D\u043D\u044B\u0435 \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u0432 Cloudflare D1 (\u0431\u0430\u0437\u0430 \u0434\u0430\u043D\u043D\u044B\u0445), Cloudflare KV (\u0444\u0440\u043E\u043D\u0442\u0435\u043D\u0434) \u0438 Cloudflare R2 (\u043C\u0435\u0434\u0438\u0430\u0444\u0430\u0439\u043B\u044B).<br>\u2014 \u0421\u0435\u0440\u0432\u0435\u0440\u044B \u0440\u0430\u0441\u043F\u043E\u043B\u043E\u0436\u0435\u043D\u044B \u0432 \u0434\u0430\u0442\u0430-\u0446\u0435\u043D\u0442\u0440\u0430\u0445 Cloudflare \u043F\u043E \u0432\u0441\u0435\u043C\u0443 \u043C\u0438\u0440\u0443.<br>\u2014 \u0421\u0440\u043E\u043A \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F: \u043F\u043E\u043A\u0430 \u0441\u0430\u0439\u0442 \u0444\u0443\u043D\u043A\u0446\u0438\u043E\u043D\u0438\u0440\u0443\u0435\u0442. \u0414\u043B\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u043E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A @shemax45 \u0432 Telegram.</p><h2>4. \u041F\u0435\u0440\u0435\u0434\u0430\u0447\u0430 \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u0440\u0435\u0442\u044C\u0438\u043C \u043B\u0438\u0446\u0430\u043C</h2><p>\u2014 \u041C\u044B \u043D\u0435 \u043F\u0440\u043E\u0434\u0430\u0451\u043C \u0438 \u043D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u0451\u043C \u0434\u0430\u043D\u043D\u044B\u0435 \u0442\u0440\u0435\u0442\u044C\u0438\u043C \u043B\u0438\u0446\u0430\u043C.<br>\u2014 \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 Cloudflare (\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432, \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435).<br>\u2014 \u041C\u0435\u0434\u0438\u0430\u0444\u0430\u0439\u043B\u044B \u043C\u043E\u0433\u0443\u0442 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0442\u044C\u0441\u044F \u0441 Telegram CDN \u0438 GitHub raw.</p><h2>5. \u0412\u0430\u0448\u0438 \u043F\u0440\u0430\u0432\u0430 (GDPR / CCPA)</h2><p>\u2014 \u041F\u0440\u0430\u0432\u043E \u043D\u0430 \u0434\u043E\u0441\u0442\u0443\u043F: \u0437\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u044C \u043A\u043E\u043F\u0438\u044E \u0432\u0430\u0448\u0438\u0445 \u0434\u0430\u043D\u043D\u044B\u0445 \u0447\u0435\u0440\u0435\u0437 @shemax45.<br>\u2014 \u041F\u0440\u0430\u0432\u043E \u043D\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435: \u043F\u043E\u0442\u0440\u0435\u0431\u043E\u0432\u0430\u0442\u044C \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0434\u0430\u043D\u043D\u044B\u0445 \u0447\u0435\u0440\u0435\u0437 @shemax45.<br>\u2014 \u041F\u0440\u0430\u0432\u043E \u043D\u0430 \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435: \u0441\u043E\u043E\u0431\u0449\u0438\u0442\u044C \u043E\u0431 \u043E\u0448\u0438\u0431\u043A\u0430\u0445 \u0432 \u0434\u0430\u043D\u043D\u044B\u0445.<br>\u2014 \u041F\u0440\u0430\u0432\u043E \u043D\u0430 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438.<br>\u2014 \u0414\u043B\u044F \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432: @shemax45 \u0432 Telegram.</p><h2>6. \u0424\u0430\u0439\u043B\u044B cookie</h2><p>\u2014 \u0421\u0430\u0439\u0442 \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B cookie \u0434\u043B\u044F \u043E\u0442\u0441\u043B\u0435\u0436\u0438\u0432\u0430\u043D\u0438\u044F.<br>\u2014 Cloudflare \u043C\u043E\u0436\u0435\u0442 \u0443\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0442\u044C \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 cookie (_cfduid \u0438 \u0430\u043D\u0430\u043B\u043E\u0433\u0438) \u0432 \u0440\u0430\u043C\u043A\u0430\u0445 \u0441\u0432\u043E\u0435\u0439 \u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u044B.</p><h2>7. \u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C</h2><p>\u2014 \u0412\u0441\u0435 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F \u0437\u0430\u0449\u0438\u0449\u0435\u043D\u044B HTTPS (TLS 1.2+).<br>\u2014 \u0410\u0434\u043C\u0438\u043D-\u043F\u0430\u043D\u0435\u043B\u044C \u0437\u0430\u0449\u0438\u0449\u0435\u043D\u0430 \u043F\u0430\u0440\u043E\u043B\u0435\u043C \u0438 Cloudflare Turnstile.<br>\u2014 \u0414\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0442 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u044F \u0447\u0430\u0441\u0442\u043E\u0442\u044B \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432 (rate limiting).</p><h2>8. \u041A\u043E\u043D\u0442\u0430\u043A\u0442\u044B</h2><p>\u041F\u043E \u0432\u043E\u043F\u0440\u043E\u0441\u0430\u043C \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438: @shemax45 \u0432 Telegram.</p></body></html>';
var GITHUB_RAW = "https://raw.githubusercontent.com/Shemax13/Singingpoetry/master/audio/";
var PODCAST_URLS = {};
PODCAST_URLS[394] = GITHUB_RAW + "The thirteenth wave podcast.m4a";
PODCAST_URLS[390] = GITHUB_RAW + "The thirteenth wave podcast.m4a";
PODCAST_URLS[228] = GITHUB_RAW + "\u0413\u0440\u0435\u0439\u043F\u0444\u0440\u0443\u0442.mp3";
PODCAST_URLS[439] = GITHUB_RAW + "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441_\u043F\u0440\u043E\u0442\u0438\u0432_\u0431\u0435\u0437\u0433\u0440\u0430\u043D\u0438\u0447\u043D\u043E\u0439_\u0433\u043B\u0443\u043F\u043E\u0441\u0442\u0438.m4a";
PODCAST_URLS[448] = GITHUB_RAW + "\u0420\u0442\u0443\u0442\u044C_\u043E\u0442_\u0433\u0440\u0430\u0434\u0443\u0441\u043D\u0438\u043A\u0430_\u0434\u043E_\u0441\u043C\u0435\u0440\u0442\u0435\u043B\u044C\u043D\u043E\u0439_\u0443\u0433\u0440\u043E\u0437\u044B.m4a";
PODCAST_URLS[440] = GITHUB_RAW + "\u0421\u0442\u0438\u0445\u043E\u0442\u0432\u043E\u0440\u0435\u043D\u0438\u0435_\u0428\u0435\u0439\u043D\u0438\u043D\u0430_\u0411\u0435\u0441\u0441\u043D\u0435\u0436\u043D\u0430\u044F_\u0437\u0438\u043C\u0430_\u0438_\u0442\u0440\u0435\u0432\u043E\u0433\u0430.m4a";
PODCAST_URLS[226] = GITHUB_RAW + "\u041A\u0430\u043A_\u043C\u0438\u0440_\u0432\u0441\u0442\u0440\u0435\u0447\u0430\u0435\u0442_\u041D\u043E\u0432\u044B\u0439_\u0433\u043E\u0434_\u043E\u0442_\u0418\u0441\u043F\u0430\u043D\u0438\u0438_\u0434\u043E_\u042F\u043F\u043E\u043D\u0438\u0438.m4a";
PODCAST_URLS[231] = GITHUB_RAW + "\u041C\u0430\u043A\u0441\u0438\u043C_\u0428\u0435\u0439\u043D\u0438\u043D_\u041E\u043D\u0430_\u0445\u0443\u0434\u043E\u0436\u043D\u0438\u043A_\u041F\u0441\u0438\u0445\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0430\u044F_\u0434\u0440\u0430\u043C\u0430_\u0441\u0442\u0438\u0445\u0430.m4a";
var worker_default = {
  async fetch(request, env) {
    var DB = env.DB;
    var TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    var STATIC = env.STATIC;
    var WEBHOOK_SECRET = env.WEBHOOK_SECRET;
    var ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    var url = new URL(request.url);
    var path = url.pathname;
    var method = request.method;
    var requestId = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36);
    function slog(level, msg2, data) {
      console.log(JSON.stringify({ service: "poetry", level, msg: msg2, requestId, ts: (/* @__PURE__ */ new Date()).toISOString(), data: data || {} }));
    }
    if (method === "OPTIONS") return new Response(null, { headers: path.startsWith("/api/admin/") ? corsRestricted : cors });
    if (path.startsWith("/api/")) {
      var d = db(DB);
      var botAPI = tg(TELEGRAM_BOT_TOKEN, STATIC);
      slog("info", "request", { method, path, requestId });
      var rlKey = request.headers.get("CF-Connecting-IP") || "unknown";
      var isAdminPath = path.startsWith("/api/admin/");
      var rlScope = path === "/api/admin/login" ? "login" : isAdminPath ? "admin" : "public";
      var rlMax = path === "/api/admin/login" ? 5 : isAdminPath ? 20 : 100;
      var rlResp = rateLimitResponse("rl:" + rlKey + ":" + rlScope, rlMax, RATE_LIMIT_WINDOW);
      if (rlResp) {
        slog("warn", "rate_limited", { key: rlKey, path });
        return rlResp;
      }
      if (method === "GET" && path === "/api/songs") {
        var songs = await d.getSongs(true, safeInt(url.searchParams.get("limit"), 50), safeInt(url.searchParams.get("offset"), 0));
        var count = await d.getSongsCount(true);
        var safe = [];
        for (var _si = 0; _si < songs.length; _si++) {
          var s = songs[_si];
          var mediaUrl = null;
          if (s.tg_video_url && !s.tg_video_url.startsWith("local:")) mediaUrl = s.tg_video_url;
          else if (s.suno_audio_url) mediaUrl = s.suno_audio_url;
          safe.push({
            id: s.id,
            title: s.title,
            lyrics: s.lyrics,
            cover_url: s.cover_url,
            suno_cover_url: s.suno_cover_url,
            tg_video_url: s.tg_video_url,
            suno_audio_url: s.suno_audio_url,
            media_url: mediaUrl,
            podcast_count: s.podcast_count || (PODCAST_URLS[s.id] ? 1 : 0),
            podcast_audio_url: s.podcast_audio_url || PODCAST_URLS[s.id] || null,
            duration: s.duration,
            language: s.language,
            published_at: s.published_at,
            order_index: s.order_index
          });
          if (s.tg_file_id) botAPI.getFile(s.tg_file_id).catch(function(e2) {
            slog("error", "getFile_warm_failed", { songId: s.id, error: e2.message });
          });
        }
        return json({ ok: true, data: safe, count });
      }
      var m = path.match(/^\/api\/songs\/(\d+)$/);
      if (m && method === "GET") {
        var song = await d.getPublicSong(parseInt(m[1], 10));
        if (!song) return err("Not found", 404);
        var mediaUrl = null;
        if (song.tg_video_url && !song.tg_video_url.startsWith("local:")) mediaUrl = song.tg_video_url;
        else if (song.suno_audio_url) mediaUrl = song.suno_audio_url;
        var safeSong = {
          id: song.id,
          title: song.title,
          lyrics: song.lyrics,
          cover_url: song.cover_url,
          suno_cover_url: song.suno_cover_url,
          tg_video_url: song.tg_video_url,
          suno_audio_url: song.suno_audio_url,
          media_url: mediaUrl,
          podcast_count: song.podcast_count || (PODCAST_URLS[song.id] ? 1 : 0),
          podcast_audio_url: song.podcast_audio_url || PODCAST_URLS[song.id] || null,
          duration: song.duration,
          language: song.language,
          published_at: song.published_at,
          order_index: song.order_index
        };
        return json({ ok: true, data: safeSong });
      }
      m = path.match(/^\/api\/songs\/(\d+)\/next$/);
      if (m && method === "GET") {
        var next = await d.getNextSong(parseInt(m[1], 10));
        return next ? json({ ok: true, data: next }) : err("No next", 404);
      }
      m = path.match(/^\/api\/song\/(\d+)\/podcasts$/);
      if (m && method === "GET") {
        var songId = parseInt(m[1], 10);
        var ps = await d.getExtraAudio(songId, "podcast");
        if (!ps.length && PODCAST_URLS[songId]) {
          ps = [{ id: 0, song_id: songId, title: "\u041F\u043E\u0434\u043A\u0430\u0441\u0442", file_url: PODCAST_URLS[songId], file_type: "podcast", visible: 1 }];
        }
        return json({ ok: true, data: ps });
      }
      m = path.match(/^\/api\/song\/(\d+)\/links$/);
      if (m && method === "GET") {
        var links = await d.getSongExternalLinks(parseInt(m[1], 10));
        return json({ ok: true, data: links });
      }
      m = path.match(/^\/api\/media\/(\d+)$/);
      if (m && method === "GET") {
        try {
          var songId = parseInt(m[1], 10);
          var song = await d.getPublicSong(songId);
          if (!song) return err("Not found", 404);
          var mediaUrl = null;
          if (song.tg_file_id) {
            try {
              var fi = await botAPI.getFile(song.tg_file_id);
              mediaUrl = botAPI.getFileUrl(fi.file_path);
            } catch (e2) {
            }
          }
          if (!mediaUrl && song.tg_message_url) {
            try {
              var linkUrl = song.tg_message_url;
              var mPub = linkUrl.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/);
              var mPriv = linkUrl.match(/t\.me\/c\/(\d+)\/(\d+)/);
              var parsed = mPub ? { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) } : mPriv ? { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) } : null;
              if (parsed) {
                var fwdTarget = env.TG_FORWARD_TARGET || "@ShemaxPoetryFreeChat";
                var fwd = await (await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/forwardMessage", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: fwdTarget, from_chat_id: parsed.channel, message_id: parsed.msgId })
                })).json();
                if (fwd.ok && fwd.result) {
                  var fwdMsg = fwd.result;
                  var freshFileId = null;
                  if (fwdMsg.video) freshFileId = fwdMsg.video.file_id;
                  else if (fwdMsg.audio) freshFileId = fwdMsg.audio.file_id;
                  else if (fwdMsg.voice) freshFileId = fwdMsg.voice.file_id;
                  try {
                    await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: fwdTarget, message_id: fwdMsg.message_id }) });
                  } catch (e2) {
                  }
                  if (freshFileId) {
                    var freshFi = await botAPI.getFile(freshFileId);
                    mediaUrl = botAPI.getFileUrl(freshFi.file_path);
                    DB.prepare("UPDATE songs SET tg_file_id=? WHERE id=?").bind(freshFileId, song.id).run().catch(function() {
                    });
                  }
                }
              }
            } catch (e2) {
            }
          }
          if (!mediaUrl && song.tg_video_url && !song.tg_video_url.startsWith("local:")) mediaUrl = song.tg_video_url;
          if (!mediaUrl && song.suno_audio_url) mediaUrl = song.suno_audio_url;
          if (!mediaUrl && (song.podcast_audio_url || PODCAST_URLS[song.id])) mediaUrl = song.podcast_audio_url || PODCAST_URLS[song.id];
          if (!mediaUrl) return err("No media", 404);
          var resp = new Response(null, { status: 302, headers: { "Location": mediaUrl, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" } });
          return addSecurityHeaders(resp);
        } catch (e2) {
          return err("Media error");
        }
      }
      m = path.match(/^\/api\/upload-video\/(\d+)$/);
      if (m && method === "POST") {
        if (!await isAuth(request, DB)) return err("Unauthorized", 401);
        try {
          var songId = parseInt(m[1], 10);
          if (!songId) return err("Invalid id", 400);
          var githubToken = env.GITHUB_TOKEN;
          if (!githubToken) return err("GitHub token not configured", 503);
          var contentType = request.headers.get("Content-Type") || "video/mp4";
          if (contentType.length > 100) return err("Invalid content type", 400);
          var extMap = { "mp4": ".mp4", "webm": ".webm", "ogg": ".ogg", "mp3": ".mp3", "mpeg": ".mp3", "m4a": ".m4a" };
          var ext = ".mp4";
          for (var c in extMap) {
            if (contentType.indexOf(c) !== -1) {
              ext = extMap[c];
              break;
            }
          }
          var arrayBuffer = await request.arrayBuffer();
          if (arrayBuffer.byteLength > 50 * 1024 * 1024) return err("File too large (max 50MB)", 400);
          var ghPath = "videos/" + songId + ext;
          var rawUrl = "https://raw.githubusercontent.com/Shemax13/Singingpoetry/master/" + ghPath;
          var ghResp = await fetch("https://api.github.com/repos/Shemax13/Singingpoetry/contents/" + ghPath, {
            method: "PUT",
            headers: { "Authorization": "Bearer " + githubToken, "Content-Type": "application/json", "User-Agent": "shemax-poetry-worker" },
            body: JSON.stringify({ message: "cache video #" + songId, content: Buffer.from(arrayBuffer).toString("base64") })
          });
          var ghResult = await ghResp.json();
          if (!ghResp.ok) {
            slog("error", "github_upload_failed", { songId, status: ghResp.status, error: JSON.stringify(ghResult), requestId });
            return err("GitHub upload failed");
          }
          await d.upsertSong({ id: songId, tg_video_url: rawUrl });
          slog("info", "github_uploaded", { songId, size: arrayBuffer.byteLength, requestId });
          return json({ ok: true, data: { url: rawUrl, size: arrayBuffer.byteLength } });
        } catch (e2) {
          slog("error", "upload_video_error", { error: e2.message, requestId });
          return err("Upload failed");
        }
      }
      if (method === "POST" && path === "/api/webhook") {
        try {
          if (rateLimit("rl:wh:" + url.searchParams.get("secret") || "anon", 30, RATE_LIMIT_WINDOW)) return json({ ok: true });
          var whSecret = url.searchParams.get("secret") || "";
          if (WEBHOOK_SECRET && whSecret !== WEBHOOK_SECRET) {
            slog("warn", "webhook_invalid_secret", { requestId });
            return json({ ok: true });
          }
          var raw = await request.text();
          if (!raw || raw.length > 1e5) {
            slog("warn", "webhook_invalid_body", { length: (raw || "").length, requestId });
            return json({ ok: true });
          }
          var update;
          try {
            update = JSON.parse(raw);
          } catch (e2) {
            return json({ ok: true });
          }
          var p = parseMsgFull(update);
          if (!p || !p.tg_msg_id) return json({ ok: true });
          if (!p.chat_type || !p.text_content || p.text_content.length > 5e3) p.text_content = (p.text_content || "").substring(0, 5e3);
          var existingMsg = await d.getMessageByChatAndMsg(p.chat_id, p.tg_msg_id);
          if (existingMsg) {
            slog("info", "webhook_dup_msg", { tgMsgId: p.tg_msg_id, chat: p.chat_id, requestId });
            return json({ ok: true });
          }
          if (p.chat_type === "channel" || p.chat_type === "group") {
            var msgId = await d.storeMessage(p);
            if (msgId && p.forward_from_chat_id && p.forward_from_msg_id && p.file_id) {
              try {
                var fileInfo = await botAPI.getFile(p.file_id);
                p.file_url = botAPI.getFileUrl(fileInfo.file_path);
              } catch (e2) {
              }
            }
            if (msgId && p.file_url) {
              await DB.prepare("UPDATE messages SET file_url=? WHERE id=?").bind(p.file_url, msgId).run();
            }
          }
          var msgIdForDedup = p.forward_from_msg_id || p.tg_msg_id;
          var isSong = (p.msg_type === "video" || p.msg_type === "audio" || p.msg_type === "document" && p.mime_type && p.mime_type.startsWith("audio/")) && p.file_id;
          var songObj = null;
          if (isSong) {
            if (await d.getByTgMsg(msgIdForDedup)) {
              slog("info", "webhook_dup_song", { tgMsgId: msgIdForDedup, requestId });
              return json({ ok: true });
            }
            var fileInfo;
            try {
              fileInfo = await botAPI.getFile(p.file_id);
            } catch (e2) {
              return json({ ok: true });
            }
            songObj = { title: firstLine2(p.text_content), lyrics: p.text_content || null, telegram_message_id: msgIdForDedup, published_at: p.published_at };
            if (p.msg_type === "video") {
              songObj.tg_video_url = botAPI.getFileUrl(fileInfo.file_path);
              songObj.tg_file_id = p.file_id;
            } else {
              songObj.suno_audio_url = botAPI.getFileUrl(fileInfo.file_path);
            }
            await d.upsertSong(songObj);
            slog("info", "webhook_song_created", { tgMsgId: msgIdForDedup, title: songObj.title, requestId });
          }
          var sunoUrls = sunoExtractUrls(p.text_content);
          if (sunoUrls.length) {
            var targetSongId = null;
            if (songObj) {
              var tmp = await d.getByTgMsg(msgIdForDedup);
              if (tmp) targetSongId = tmp.id;
            }
            if (!targetSongId && p.forward_from_msg_id) {
              var tmp = await d.getByTgMsg(p.forward_from_msg_id);
              if (tmp) targetSongId = tmp.id;
            }
            for (var si = 0; si < sunoUrls.length; si++) {
              var sinfo = await processSunoUrl(sunoUrls[si]);
              if (sinfo) {
                var upd = { suno_audio_url: sinfo.audioUrl, suno_cover_url: sinfo.coverUrl, suno_track_url: sinfo.trackUrl };
                if (targetSongId) {
                  var cur = await d.getSong(targetSongId);
                  if (cur) {
                    upd.id = targetSongId;
                    upd.title = cur.title || sinfo.title;
                    upd.lyrics = cur.lyrics || p.text_content || null;
                    upd.telegram_message_id = cur.telegram_message_id || msgIdForDedup;
                    upd.published_at = cur.published_at || p.published_at;
                  }
                } else {
                  upd.title = sinfo.title;
                  upd.lyrics = p.text_content || null;
                  upd.telegram_message_id = msgIdForDedup;
                  upd.published_at = p.published_at;
                }
                var saved = await d.upsertSong(upd);
                if (!targetSongId) targetSongId = saved.id;
                slog("info", "webhook_suno_attached", { songId: targetSongId, sunoUrl: sunoUrls[si], requestId });
              }
            }
          }
          return json({ ok: true });
        } catch (e2) {
          slog("error", "webhook_error", { error: e2.message, requestId });
          return json({ ok: true });
        }
      }
      if (method === "POST" && path === "/api/admin/login") {
        var body = await safeJSON(request);
        if (!body || !body.password || typeof body.password !== "string" || body.password.length > 256) return err("Password required", 400);
        var turnstileToken = body.turnstile_token || "";
        if (turnstileToken) {
          var verifyResp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken })
          });
          var verifyData = await verifyResp.json();
          if (!verifyData.success) return err("CAPTCHA verification failed", 400);
        }
        if (body.password === ADMIN_PASSWORD) {
          var token = genToken();
          var exp = new Date(Date.now() + 864e5).toISOString();
          await d.createSession(token, exp);
          return secureJSON({ ok: true, data: { token } });
        }
        await new Promise(function(r2) {
          return setTimeout(r2, 1e3);
        });
        return err("Invalid password", 401);
      }
      if (path === "/api/privacy") {
        return htmlResponse(PRIVACY_HTML);
      }
      if (path.startsWith("/api/admin/")) {
        if (!await isAuth(request, DB)) return err("Unauthorized", 401);
        if (method === "GET" && path === "/api/admin/songs") return secureJSON({ ok: true, data: await d.getSongs(false, 9999, 0) });
        if (method === "POST" && path === "/api/admin/songs") {
          var body = await safeJSON(request);
          if (!body || body.title === void 0 && body.lyrics === void 0) return err("title or lyrics required", 400);
          if (body.id) return err("Use PUT /api/admin/songs/:id to update", 400);
          if (body.title && typeof body.title === "string" && body.title.length > 500) return err("title too long", 400);
          if (body.lyrics && typeof body.lyrics === "string" && body.lyrics.length > 5e4) return err("lyrics too long", 400);
          return secureJSON({ ok: true, data: await d.upsertSong(body) }, 201);
        }
        if (method === "PUT" && path === "/api/admin/songs") {
          var body = await safeJSON(request);
          if (!body) return err("Invalid JSON", 400);
          if (body.ids) {
            if (!Array.isArray(body.ids) || body.ids.length > 1e3) return err("Invalid ids", 400);
            for (var _idi = 0; _idi < body.ids.length; _idi++) {
              if (typeof body.ids[_idi] !== "number" || body.ids[_idi] < 1) return err("Invalid ids", 400);
            }
            await d.reorderSongs(body.ids);
            return secureJSON({ ok: true });
          }
          return err("Invalid", 400);
        }
        m = path.match(/^\/api\/admin\/songs\/(\d+)$/);
        if (m && method === "GET") {
          var song = await d.getSong(parseInt(m[1], 10));
          return song ? secureJSON({ ok: true, data: song }) : err("Not found", 404);
        }
        if (m && method === "PUT") {
          var body = await safeJSON(request);
          if (!body) return err("Invalid JSON", 400);
          body.id = parseInt(m[1], 10);
          if (!body.id) return err("Invalid song id", 400);
          if (body.title && typeof body.title === "string" && body.title.length > 500) return err("title too long", 400);
          if (body.lyrics && typeof body.lyrics === "string" && body.lyrics.length > 5e4) return err("lyrics too long", 400);
          return secureJSON({ ok: true, data: await d.upsertSong(body) });
        }
        if (m && method === "DELETE") {
          await d.deleteSong(parseInt(m[1], 10));
          return secureJSON({ ok: true });
        }
        m = path.match(/^\/api\/admin\/songs\/(\d+)\/extra-audio$/);
        if (m && method === "GET") {
          var audio = await d.getExtraAudio(parseInt(m[1], 10));
          return secureJSON({ ok: true, data: audio });
        }
        if (method === "GET" && path === "/api/admin/audio-files") {
          var rows = await DB.prepare("SELECT id,forward_from_msg_id,text_content,file_url,file_id,msg_type,duration,file_size,published_at FROM messages WHERE chat_type='group' AND msg_type='audio' AND file_url IS NOT NULL ORDER BY published_at DESC LIMIT 200").all();
          return secureJSON({ ok: true, data: rows.results || [] });
        }
        if (method === "POST" && path === "/api/admin/extra-audio") {
          var body = await safeJSON(request);
          if (!body || !body.song_id) return err("song_id required", 400);
          if (body.file_url && typeof body.file_url === "string" && body.file_url.length > 2e3) return err("file_url too long", 400);
          var songId = parseInt(body.song_id, 10);
          if (isNaN(songId) || songId < 1) return err("Invalid song_id", 400);
          var result = await d.upsertExtraAudio({
            song_id: songId,
            title: body.title || null,
            file_url: body.file_url || null,
            file_type: body.file_type || "podcast",
            source: body.source || "telegram",
            telegram_message_id: body.telegram_message_id ? parseInt(body.telegram_message_id, 10) : null,
            duration: body.duration ? parseInt(body.duration, 10) : null
          });
          slog("info", "extra_audio_created", { songId, id: result.id, requestId });
          return secureJSON({ ok: true, data: result }, 201);
        }
        m = path.match(/^\/api\/admin\/extra-audio\/(\d+)$/);
        if (m && method === "PUT") {
          var body = await safeJSON(request);
          if (!body) return err("Invalid JSON", 400);
          body.id = parseInt(m[1], 10);
          var result = await d.upsertExtraAudio(body);
          return result ? secureJSON({ ok: true, data: result }) : err("Not found", 404);
        }
        if (m && method === "DELETE") {
          await d.deleteExtraAudio(parseInt(m[1], 10));
          return secureJSON({ ok: true });
        }
        if (method === "POST" && path === "/api/admin/resolve-podcast-files") {
          var rows = await DB.prepare("SELECT id,file_id FROM messages WHERE chat_type='group' AND msg_type='audio' AND file_id IS NOT NULL AND file_url IS NULL LIMIT 50").all();
          var resolved = 0;
          for (var ri = 0; ri < (rows.results || []).length; ri++) {
            var msg = rows.results[ri];
            try {
              var fi = await botAPI.getFile(msg.file_id);
              await DB.prepare("UPDATE messages SET file_url=? WHERE id=?").bind(botAPI.getFileUrl(fi.file_path), msg.id).run();
              resolved++;
            } catch (ex) {
            }
          }
          return secureJSON({ ok: true, data: { resolved, remaining: (rows.results || []).length - resolved } });
        }
        if (method === "POST" && path === "/api/admin/setup-webhook") {
          try {
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var whUrl = url.searchParams.get("url") || "https://poetry.shemaxpoetry.workers.dev/api/webhook";
            if (whUrl.length > 500) return err("Invalid URL", 400);
            var meResp = await (await fetch(tgBase + "/getMe")).json();
            if (!meResp.ok) return secureJSON({ ok: true, data: { error: "Bot token invalid" } });
            var tgResp = await (await fetch(tgBase + "/setWebhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: whUrl, allowed_updates: ["message", "channel_post"] }) })).json();
            return secureJSON({ ok: true, data: { me: meResp.result, webhook: tgResp } });
          } catch (e2) {
            return err("Webhook setup failed");
          }
        }
        if (method === "POST" && path === "/api/admin/import-channel") {
          try {
            var body = await safeJSON(request);
            if (!body || !body.channel || !body.message_ids) return err("channel and message_ids required", 400);
            if (body.channel.length > 100 || body.message_ids.length > 5e3) return err("Invalid input", 400);
            var ids = [];
            var parts = body.message_ids.split(",");
            for (var k = 0; k < parts.length; k++) {
              var p = parts[k].trim();
              var range = p.split("-");
              if (range.length === 2) {
                var s = parseInt(range[0], 10), e = parseInt(range[1], 10);
                if (!isNaN(s) && !isNaN(e) && s > 0 && e > 0 && s <= e && e - s < 100) for (var n = s; n <= e; n++) ids.push(n);
              } else {
                var n = parseInt(p, 10);
                if (!isNaN(n) && n > 0) ids.push(n);
              }
            }
            if (!ids.length) return err("No valid IDs", 400);
            if (ids.length > 500) return err("Too many IDs (max 500)", 400);
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var imported = 0, errors = [];
            var target = body.target || "@ShemaxPoetryFreeChat";
            if (target.length > 100) return err("Invalid target", 400);
            for (var k = 0; k < ids.length; k++) {
              try {
                var r = await (await fetch(tgBase + "/forwardMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, from_chat_id: body.channel, message_id: ids[k] }) })).json();
                if (r.ok) imported++;
                else errors.push({ id: ids[k], error: r.description });
              } catch (e2) {
                errors.push({ id: ids[k], error: "Request failed" });
              }
              await new Promise(function(r2) {
                return setTimeout(r2, 300);
              });
            }
            return secureJSON({ ok: true, data: { imported, errors } });
          } catch (e2) {
            return err("Import error");
          }
        }
        if (method === "POST" && path === "/api/admin/sync") {
          var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
          var whInfo = await (await fetch(tgBase + "/getWebhookInfo")).json();
          var oldUrl = whInfo.ok ? whInfo.result.url : null;
          try {
            if (oldUrl) await fetch(tgBase + "/deleteWebhook", { method: "POST" });
            await new Promise(function(r2) {
              return setTimeout(r2, 200);
            });
            var updates = await (await fetch(tgBase + "/getUpdates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeout: 5, allowed_updates: ["message", "channel_post"] }) })).json();
            var synced = 0;
            if (updates.ok && updates.result) {
              for (var i = 0; i < updates.result.length; i++) {
                var p = parseMsgFull(updates.result[i]);
                if (!p || !p.tg_msg_id) continue;
                await d.storeMessage(p);
                var isSong = (p.msg_type === "video" || p.msg_type === "audio" || p.msg_type === "document" && p.mime_type && p.mime_type.startsWith("audio/")) && p.file_id;
                var msgId = p.forward_from_msg_id || p.tg_msg_id;
                if (isSong && !await d.getByTgMsg(msgId)) {
                  var fileInfo;
                  try {
                    fileInfo = await botAPI.getFile(p.file_id);
                  } catch (e2) {
                    continue;
                  }
                  var songObj = { title: firstLine2(p.text_content), lyrics: p.text_content || null, telegram_message_id: msgId, published_at: p.published_at };
                  if (p.msg_type === "video") {
                    songObj.tg_video_url = botAPI.getFileUrl(fileInfo.file_path);
                    songObj.tg_file_id = p.file_id;
                  } else songObj.suno_audio_url = botAPI.getFileUrl(fileInfo.file_path);
                  await d.upsertSong(songObj);
                  synced++;
                }
              }
            }
            return secureJSON({ ok: true, data: { synced } });
          } catch (e2) {
            return err("Sync error");
          } finally {
            if (oldUrl) {
              await fetch(tgBase + "/setWebhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: oldUrl, allowed_updates: ["message", "channel_post"] }) });
            }
          }
        }
        if (method === "POST" && path === "/api/admin/suno") {
          try {
            var body = await safeJSON(request);
            if (!body) return err("Invalid JSON", 400);
            if (!body.url || typeof body.url !== "string" || body.url.length > 500) return err("Invalid url", 400);
            var info = await sunoFetch(body.url);
            return secureJSON({ ok: true, data: { title: info.title, coverUrl: info.coverUrl, audioUrl: info.audioUrl, duration: info.duration } });
          } catch (e2) {
            return err("Suno error");
          }
        }
        if (method === "POST" && path === "/api/admin/daily-sync") {
          try {
            var checked = 0, updated = 0, errCount = 0;
            var rows1 = await DB.prepare("SELECT id,suno_track_url FROM songs WHERE suno_track_url IS NOT NULL AND (suno_audio_url IS NULL OR suno_audio_url='')").all();
            for (var i = 0; i < (rows1.results || []).length; i++) {
              var song = rows1.results[i];
              checked++;
              try {
                var info = await sunoFetch(song.suno_track_url);
                if (info && info.audioUrl) {
                  await DB.prepare("UPDATE songs SET suno_audio_url=?,suno_cover_url=?,title=COALESCE(NULLIF(title,'Untitled'),?),updated_at=datetime('now') WHERE id=?").bind(info.audioUrl, info.coverUrl, info.title, song.id).run();
                  updated++;
                }
              } catch (e2) {
                errCount++;
              }
            }
            var rows2 = await DB.prepare("SELECT id,lyrics,suno_track_url FROM songs WHERE lyrics LIKE '%suno.com%' AND (suno_audio_url IS NULL OR suno_audio_url='')").all();
            for (var i = 0; i < (rows2.results || []).length; i++) {
              var song = rows2.results[i];
              checked++;
              var urls = sunoExtractUrls(song.lyrics);
              for (var j = 0; j < urls.length; j++) {
                try {
                  if (song.suno_track_url && song.suno_track_url !== urls[j]) continue;
                  var info = await sunoFetch(urls[j]);
                  if (info && info.audioUrl) {
                    await DB.prepare("UPDATE songs SET suno_audio_url=?,suno_cover_url=?,suno_track_url=?,title=COALESCE(NULLIF(title,'Untitled'),?),updated_at=datetime('now') WHERE id=?").bind(info.audioUrl, info.coverUrl, urls[j], info.title, song.id).run();
                    updated++;
                    break;
                  }
                } catch (e2) {
                  errCount++;
                }
              }
            }
            return secureJSON({ ok: true, data: { checked, updated, errors: errCount } });
          } catch (e2) {
            return err("Daily sync error");
          }
        }
        if (method === "POST" && path === "/api/admin/scan-channel") {
          try {
            var body = await safeJSON(request);
            if (!body) return err("Invalid JSON", 400);
            var channel = body.channel || "@shemaxpoetry";
            if (channel.length > 100 || typeof body.from !== "undefined" && (isNaN(parseInt(body.from, 10)) || parseInt(body.from, 10) < 1)) return err("Invalid parameters", 400);
            var fromId = parseInt(body.from, 10) || 2;
            var toId = parseInt(body.to, 10) || 2e3;
            if (toId - fromId > 1e4) return err("Range too large (max 10000)", 400);
            var target = body.target || "@ShemaxPoetryFreeChat";
            if (target.length > 100) return err("Invalid target", 400);
            var delayMs = parseInt(body.delayMs, 10) || 1500;
            var maxEmpties = Math.min(parseInt(body.maxEmpties, 10) || 10, 50);
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var found = [], errors = [], consecutiveEmpty = 0;
            for (var id = fromId; id <= toId; id++) {
              try {
                var r = await (await fetch(tgBase + "/forwardMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, from_chat_id: channel, message_id: id }) })).json();
                if (r.ok) {
                  consecutiveEmpty = 0;
                  found.push(id);
                  var fwd = r.result;
                  var msgData = {
                    tg_msg_id: fwd.message_id,
                    chat_id: target,
                    chat_type: "group",
                    msg_type: "text",
                    text_content: fwd.caption || fwd.text || null,
                    file_id: null,
                    file_unique_id: null,
                    file_url: null,
                    mime_type: null,
                    file_size: null,
                    duration: null,
                    file_name: null,
                    cover_file_id: null,
                    forward_from_chat_id: channel,
                    forward_from_msg_id: id,
                    reply_to_msg_id: null,
                    reply_to_chat_id: null,
                    published_at: new Date((fwd.date || 0) * 1e3).toISOString()
                  };
                  if (fwd.video) {
                    msgData.msg_type = "video";
                    msgData.file_id = fwd.video.file_id;
                    msgData.file_unique_id = fwd.video.file_unique_id;
                    msgData.mime_type = fwd.video.mime_type || null;
                    msgData.file_size = fwd.video.file_size || null;
                    msgData.duration = fwd.video.duration || null;
                    if (fwd.video.thumbnail) msgData.cover_file_id = fwd.video.thumbnail.file_id;
                  } else if (fwd.audio) {
                    msgData.msg_type = "audio";
                    msgData.file_id = fwd.audio.file_id;
                    msgData.file_unique_id = fwd.audio.file_unique_id;
                    msgData.mime_type = fwd.audio.mime_type || null;
                    msgData.file_size = fwd.audio.file_size || null;
                    msgData.duration = fwd.audio.duration || null;
                    msgData.file_name = fwd.audio.file_name || null;
                  } else if (fwd.voice) {
                    msgData.msg_type = "voice";
                    msgData.file_id = fwd.voice.file_id;
                    msgData.file_unique_id = fwd.voice.file_unique_id;
                    msgData.mime_type = "audio/ogg";
                    msgData.file_size = fwd.voice.file_size || null;
                    msgData.duration = fwd.voice.duration || null;
                  } else if (fwd.photo && fwd.photo.length) {
                    msgData.msg_type = "photo";
                    var bp = fwd.photo[fwd.photo.length - 1];
                    msgData.file_id = bp.file_id;
                    msgData.file_unique_id = bp.file_unique_id;
                    msgData.cover_file_id = bp.file_id;
                  } else if (fwd.document) {
                    msgData.msg_type = "document";
                    msgData.file_id = fwd.document.file_id;
                    msgData.file_unique_id = fwd.document.file_unique_id;
                    msgData.mime_type = fwd.document.mime_type || null;
                    msgData.file_size = fwd.document.file_size || null;
                  }
                  await d.storeMessage(msgData);
                } else {
                  consecutiveEmpty++;
                  if (consecutiveEmpty >= maxEmpties) break;
                }
              } catch (e2) {
                consecutiveEmpty++;
                errors.push({ id, error: e2.message });
                if (consecutiveEmpty >= maxEmpties) break;
              }
              await new Promise(function(r2) {
                return setTimeout(r2, delayMs);
              });
            }
            return secureJSON({ ok: true, data: { found, count: found.length, scannedUpTo: found.length ? found[found.length - 1] : fromId, nextFrom: found.length ? found[found.length - 1] + 1 : fromId } });
          } catch (e2) {
            slog("error", "scan_error", { error: e2.message, requestId });
            return err("Scan error");
          }
        }
        if (method === "GET" && path === "/api/admin/publications") {
          try {
            var pubs = await d.getPublications();
            return secureJSON({ ok: true, data: pubs });
          } catch (e2) {
            slog("error", "publications_error", { error: e2.message, requestId });
            return err("Publications error");
          }
        }
        if (method === "GET" && path === "/api/admin/messages") {
          try {
            var chatType = url.searchParams.get("chat_type") || null;
            if (chatType && !["channel", "group"].includes(chatType)) return err("Invalid chat_type", 400);
            var limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
            var offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
            var msgs = await d.getMessages(chatType, limit, offset);
            var stats = await d.getMessageStats();
            return secureJSON({ ok: true, data: { messages: msgs, stats } });
          } catch (e2) {
            slog("error", "messages_error", { error: e2.message, requestId });
            return err("Messages error");
          }
        }
        if (method === "POST" && path === "/api/admin/resolve-files") {
          try {
            var body = await safeJSON(request);
            var limit = Math.min(parseInt(body && body.limit || "50", 10), 200);
            var rows = await DB.prepare("SELECT id,file_id FROM messages WHERE file_id IS NOT NULL AND file_url IS NULL LIMIT ?").bind(limit).all();
            var resolved = 0;
            for (var i = 0; i < (rows.results || []).length; i++) {
              var msg = rows.results[i];
              try {
                var fi = await botAPI.getFile(msg.file_id);
                await DB.prepare("UPDATE messages SET file_url=? WHERE id=?").bind(botAPI.getFileUrl(fi.file_path), msg.id).run();
                resolved++;
              } catch (ex) {
              }
            }
            return secureJSON({ ok: true, data: { resolved, remaining: limit - resolved } });
          } catch (e2) {
            slog("error", "resolve_error", { error: e2.message, requestId });
            return err("Resolve error");
          }
        }
        if (method === "POST" && path === "/api/admin/resolve-covers") {
          try {
            var body = await safeJSON(request);
            var limit = Math.min(parseInt(body && body.limit || "100", 10), 200);
            var rows = await DB.prepare("SELECT id,cover_file_id,forward_from_msg_id FROM messages WHERE cover_file_id IS NOT NULL AND cover_url IS NULL LIMIT ?").bind(limit).all();
            var resolved = 0;
            for (var i = 0; i < (rows.results || []).length; i++) {
              var msg = rows.results[i];
              try {
                var fi = await botAPI.getFile(msg.cover_file_id);
                var cu = botAPI.getFileUrl(fi.file_path);
                await DB.prepare("UPDATE messages SET cover_url=? WHERE id=?").bind(cu, msg.id).run();
                if (msg.forward_from_msg_id) {
                  var song = await DB.prepare("SELECT id FROM songs WHERE telegram_message_id=? AND (cover_url IS NULL OR cover_url='')").bind(msg.forward_from_msg_id).first();
                  if (song) await DB.prepare("UPDATE songs SET cover_url=? WHERE id=?").bind(cu, song.id).run();
                }
                resolved++;
              } catch (ex) {
              }
            }
            return secureJSON({ ok: true, data: { resolved, remaining: (rows.results || []).length - resolved } });
          } catch (e2) {
            slog("error", "resolve_covers_error", { error: e2.message, requestId });
            return err("Resolve covers error");
          }
        }
        if (method === "POST" && path === "/api/admin/create-songs") {
          try {
            var body = await safeJSON(request);
            if (!body) return err("Invalid JSON", 400);
            var limit = Math.min(parseInt(body.limit || "100", 10), 500);
            var offset = Math.max(parseInt(body.offset || "0", 10), 0);
            var rows = await DB.prepare("SELECT m.id,m.forward_from_msg_id,m.msg_type,m.file_id,m.cover_url,m.text_content,m.published_at FROM messages m LEFT JOIN songs s ON s.telegram_message_id=m.forward_from_msg_id WHERE m.forward_from_msg_id IS NOT NULL AND m.file_id IS NOT NULL AND (m.msg_type='video' OR m.msg_type='audio' OR (m.msg_type='voice')) AND s.id IS NULL GROUP BY m.forward_from_msg_id ORDER BY m.forward_from_msg_id ASC LIMIT ? OFFSET ?").bind(limit, offset).all();
            var created = 0;
            for (var i = 0; i < (rows.results || []).length; i++) {
              var msg = rows.results[i];
              try {
                var title = firstLine2(msg.text_content) || "Song #" + msg.forward_from_msg_id;
                var songData = { title, lyrics: msg.text_content || null, telegram_message_id: msg.forward_from_msg_id, published_at: msg.published_at };
                if (msg.msg_type === "video") {
                  songData.tg_file_id = msg.file_id;
                  try {
                    var fi = await botAPI.getFile(msg.file_id);
                    songData.tg_video_url = botAPI.getFileUrl(fi.file_path);
                  } catch (e2) {
                  }
                } else if (msg.msg_type === "audio" || msg.msg_type === "voice") {
                  try {
                    var fi = await botAPI.getFile(msg.file_id);
                    songData.suno_audio_url = botAPI.getFileUrl(fi.file_path);
                  } catch (e2) {
                  }
                }
                if (msg.cover_url) songData.cover_url = msg.cover_url;
                await d.upsertSong(songData);
                created++;
              } catch (e2) {
              }
            }
            var remaining = await DB.prepare("SELECT COUNT(DISTINCT m.forward_from_msg_id) as c FROM messages m LEFT JOIN songs s ON s.telegram_message_id=m.forward_from_msg_id WHERE m.forward_from_msg_id IS NOT NULL AND m.file_id IS NOT NULL AND (m.msg_type='video' OR m.msg_type='audio' OR m.msg_type='voice') AND s.id IS NULL").first();
            return secureJSON({ ok: true, data: { created, remaining: remaining && remaining.c || 0 } });
          } catch (e2) {
            return err("Create songs error");
          }
        }
        if (method === "GET" && path === "/api/admin/debug-bot") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
          var me = await (await fetch(tgBase + "/getMe")).json();
          var chatInfo = null;
          var joinResult = null;
          var webhookInfo = null;
          if (me.ok) {
            var chatParam = url.searchParams.get("chat_id");
            if (chatParam) {
              chatInfo = await (await fetch(tgBase + "/getChat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatParam }) })).json();
            }
            var joinLink = url.searchParams.get("join");
            if (joinLink) {
              joinResult = await (await fetch(tgBase + "/joinChat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: joinLink }) })).json();
            }
            webhookInfo = await (await fetch(tgBase + "/getWebhookInfo")).json();
            var pendingUpdates = await (await fetch(tgBase + "/getUpdates?offset=0&limit=100")).json();
            var dropPending = url.searchParams.get("drop_pending");
            if (dropPending === "true") {
              if (pendingUpdates.ok && pendingUpdates.result.length > 0) {
                var lastId = pendingUpdates.result[pendingUpdates.result.length - 1].update_id;
                await (await fetch(tgBase + "/getUpdates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: lastId + 1 }) })).json();
              }
            }
          }
          return secureJSON({ ok: true, data: { me, chat: chatInfo, join: joinResult, webhook: webhookInfo, pendingUpdates } });
        }
        if (method === "POST" && path === "/api/admin/resolve-tg-link") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            if (!body || !body.url) return err("url required", 400);
            var target = body.target || "@ShemaxPoetryFreeChat";
            var songId = parseInt(body.song_id, 10) || null;
            var linkUrl = body.url.trim();
            var parsed = null;
            var mPub = linkUrl.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/);
            var mPriv = linkUrl.match(/t\.me\/c\/(\d+)\/(\d+)/);
            if (mPub) parsed = { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) };
            else if (mPriv) parsed = { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) };
            if (!parsed) return err("Invalid t.me link format", 400);
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var fwd = await (await fetch(tgBase + "/forwardMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: target, from_chat_id: parsed.channel, message_id: parsed.msgId })
            })).json();
            if (!fwd.ok) return err("forwardMessage failed: " + (fwd.description || "unknown"), 400);
            var fwdMsg = fwd.result;
            var fileId = null, freshUrl = null, mediaType = null;
            if (fwdMsg.video) {
              fileId = fwdMsg.video.file_id;
              mediaType = "video";
            } else if (fwdMsg.audio) {
              fileId = fwdMsg.audio.file_id;
              mediaType = "audio";
            } else if (fwdMsg.voice) {
              fileId = fwdMsg.voice.file_id;
              mediaType = "audio";
            } else if (fwdMsg.document) {
              fileId = fwdMsg.document.file_id;
              mediaType = "document";
            }
            try {
              await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwdMsg.message_id }) });
            } catch (e2) {
            }
            if (!fileId) return err("No media in message", 400);
            try {
              var fi = await botAPI.getFile(fileId);
              freshUrl = botAPI.getFileUrl(fi.file_path);
            } catch (e2) {
              return err("getFile failed: " + e2.message, 400);
            }
            if (songId) {
              var updates = ["tg_file_id=?"];
              var vals = [fileId];
              if (mediaType === "video") {
                updates.push("tg_video_url=?");
                vals.push(freshUrl);
              }
              vals.push(songId);
              await DB.prepare("UPDATE songs SET " + updates.join(",") + ",updated_at=datetime('now') WHERE id=?").bind(...vals).run();
            }
            return secureJSON({ ok: true, data: {
              file_id: fileId,
              fresh_url: freshUrl,
              media_type: mediaType,
              channel: parsed.channel,
              msg_id: parsed.msgId,
              song_id: songId
            } });
          } catch (e2) {
            slog("error", "resolve_tg_link_error", { error: e2.message });
            return err("Resolve error");
          }
        }
        if (method === "POST" && path === "/api/admin/batch-resolve-tg") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            var target = body.target || "@ShemaxPoetryFreeChat";
            var limit = Math.min(parseInt(body.limit || "10", 10), 50);
            var delayMs = parseInt(body.delayMs, 10) || 1500;
            var dryRun = !!body.dry_run;
            var songs = await DB.prepare("SELECT id,tg_message_url,tg_file_id FROM songs WHERE tg_message_url IS NOT NULL AND tg_file_id IS NULL AND visible=1 LIMIT ?").bind(limit).all();
            var resolved = 0, errors = [];
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            for (var i = 0; i < (songs.results || []).length; i++) {
              var song = songs.results[i];
              var linkUrl = song.tg_message_url;
              var mPub = linkUrl.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/);
              var mPriv = linkUrl.match(/t\.me\/c\/(\d+)\/(\d+)/);
              var parsed = mPub ? { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) } : mPriv ? { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) } : null;
              if (!parsed) {
                errors.push({ songId: song.id, error: "invalid_link" });
                continue;
              }
              try {
                var fwd = await (await fetch(tgBase + "/forwardMessage", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: target, from_chat_id: parsed.channel, message_id: parsed.msgId })
                })).json();
                if (!fwd.ok) {
                  errors.push({ songId: song.id, error: fwd.description || "forward_failed" });
                  continue;
                }
                var fwdMsg = fwd.result;
                var fileId = null;
                if (fwdMsg.video) fileId = fwdMsg.video.file_id;
                else if (fwdMsg.audio) fileId = fwdMsg.audio.file_id;
                else if (fwdMsg.voice) fileId = fwdMsg.voice.file_id;
                try {
                  await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwdMsg.message_id }) });
                } catch (e2) {
                }
                if (!fileId) {
                  errors.push({ songId: song.id, error: "no_media" });
                  continue;
                }
                if (!dryRun) {
                  await DB.prepare("UPDATE songs SET tg_file_id=?,updated_at=datetime('now') WHERE id=?").bind(fileId, song.id).run();
                }
                resolved++;
              } catch (e2) {
                errors.push({ songId: song.id, error: e2.message });
              }
              if (i < songs.results.length - 1) await new Promise(function(r2) {
                return setTimeout(r2, delayMs);
              });
            }
            var remaining = await DB.prepare("SELECT COUNT(*) as c FROM songs WHERE tg_message_url IS NOT NULL AND tg_file_id IS NULL AND visible=1").first();
            return secureJSON({ ok: true, data: { resolved, errors: errors.length, remaining: remaining && remaining.c || 0, dryRun, errorDetails: errors.slice(0, 20) } });
          } catch (e2) {
            slog("error", "batch_resolve_error", { error: e2.message });
            return err("Batch resolve error");
          }
        }
        if (method === "GET" && path === "/api/admin/check-urls") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var limit = Math.min(parseInt(url.searchParams.get("limit") || "5", 10), 20);
            var rows = await DB.prepare("SELECT id,tg_video_url FROM songs WHERE tg_video_url IS NOT NULL AND visible=1 ORDER BY id ASC LIMIT ?").bind(limit).all();
            var results = [];
            for (var i = 0; i < (rows.results || []).length; i++) {
              var s = rows.results[i];
              try {
                var r = await fetch(s.tg_video_url, { method: "HEAD", redirect: "follow" });
                results.push({ id: s.id, status: r.status, ok: r.ok, url: s.tg_video_url.substring(0, 80) + "..." });
              } catch (e2) {
                results.push({ id: s.id, error: e2.message, url: s.tg_video_url.substring(0, 80) + "..." });
              }
            }
            return secureJSON({ ok: true, data: results });
          } catch (e2) {
            return err("Check error");
          }
        }
        if (method === "POST" && path === "/api/admin/scan-and-repair") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            if (!body) return err("Invalid JSON", 400);
            var channel = body.channel || "@shemaxpoetry";
            var target = body.target || "@ShemaxPoetryFreeChat";
            var fromId = parseInt(body.from, 10) || 1;
            var toId = parseInt(body.to, 10) || 2e3;
            if (toId - fromId > 1e4) return err("Range too large", 400);
            var delayMs = parseInt(body.delayMs, 10) || 500;
            var maxEmpties = Math.min(parseInt(body.maxEmpties, 10) || 50, 200);
            var dryRun = !!body.dry_run;
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var songsRows = await DB.prepare("SELECT id,title,lyrics,tg_video_url,tg_file_id FROM songs WHERE visible=1").all();
            var songs = songsRows.results || [];
            var titleToSong = {};
            for (var si = 0; si < songs.length; si++) {
              var norm = (songs[si].title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
              if (norm) titleToSong[norm] = songs[si];
            }
            var found = [], matched = [], skipped = 0, consecutiveEmpty = 0;
            var total = 0, totalMatched = 0;
            for (var id = fromId; id <= toId; id++) {
              total++;
              try {
                var r = await (await fetch(tgBase + "/forwardMessage", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: target, from_chat_id: channel, message_id: id })
                })).json();
                if (r.ok) {
                  consecutiveEmpty = 0;
                  var fwd = r.result;
                  var text = fwd.caption || fwd.text || "";
                  var fileId = null;
                  var msgType = "text";
                  if (fwd.video) {
                    fileId = fwd.video.file_id;
                    msgType = "video";
                  } else if (fwd.audio) {
                    fileId = fwd.audio.file_id;
                    msgType = "audio";
                  } else if (fwd.voice) {
                    fileId = fwd.voice.file_id;
                    msgType = "voice";
                  }
                  var firstLine2 = (text.split("\n")[0] || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
                  var match = titleToSong[firstLine2] || null;
                  if (!match && firstLine2.length > 5) {
                    for (var k in titleToSong) {
                      if (k.length > 5 && (firstLine2.indexOf(k) !== -1 || k.indexOf(firstLine2) !== -1)) {
                        match = titleToSong[k];
                        break;
                      }
                    }
                  }
                  if (!match && fileId && text.length > 20) {
                    var normText = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
                    for (var si2 = 0; si2 < songs.length; si2++) {
                      if (songs[si2].tg_file_id) continue;
                      var lyrics = (songs[si2].lyrics || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
                      if (lyrics.length > 20 && normText.length > 20) {
                        if (lyrics.substring(0, 100) === normText.substring(0, 100)) {
                          match = songs[si2];
                          break;
                        }
                      }
                    }
                  }
                  if (match) {
                    found.push(id);
                    if (fileId && !match.tg_file_id && !dryRun) {
                      await DB.prepare("UPDATE songs SET tg_file_id=?, telegram_message_id=? WHERE id=?").bind(fileId, id, match.id).run();
                      matched.push({ songId: match.id, songTitle: match.title.substring(0, 50), channelId: id, fileId: fileId.substring(0, 20) + "..." });
                      totalMatched++;
                      slog("info", "scan_repair_match", { songId: match.id, channelId: id });
                    } else if (fileId) {
                      found.push(id);
                    }
                  }
                  if (!dryRun) {
                    try {
                      await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwd.message_id }) });
                    } catch (e2) {
                    }
                  }
                } else {
                  consecutiveEmpty++;
                  if (consecutiveEmpty >= maxEmpties) break;
                }
              } catch (e2) {
                consecutiveEmpty++;
                if (consecutiveEmpty >= maxEmpties) break;
              }
              if (total % 50 === 0) slog("info", "scan_repair_progress", { scanned: total, matched: totalMatched });
              await new Promise(function(r2) {
                return setTimeout(r2, delayMs);
              });
            }
            var stillMissing = await DB.prepare("SELECT COUNT(*) as c FROM songs WHERE tg_file_id IS NULL AND visible=1").first();
            return secureJSON({ ok: true, data: {
              scanned: total,
              channelPostsFound: found.length,
              matched: matched.length,
              stillMissing: stillMissing && stillMissing.c || 0,
              dryRun,
              matches: matched.slice(0, 30)
            } });
          } catch (e2) {
            slog("error", "scan_repair_error", { error: e2.message });
            return err("Scan repair error");
          }
        }
        if (method === "GET" && path === "/api/admin/scan-preview") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          var channel = url.searchParams.get("channel") || "@shemaxpoetry";
          var target = url.searchParams.get("target") || "-1004422179990";
          var from = parseInt(url.searchParams.get("from"), 10) || 1;
          var to = parseInt(url.searchParams.get("to"), 10) || 10;
          if (to - from > 100) to = from + 100;
          var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
          var posts = [];
          for (var id = from; id <= to; id++) {
            try {
              var r = await (await fetch(tgBase + "/forwardMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, from_chat_id: channel, message_id: id }) })).json();
              if (r.ok) {
                var fwd = r.result;
                var caption = fwd.caption || fwd.text || "";
                var fileId = null;
                if (fwd.video) fileId = fwd.video.file_id;
                else if (fwd.audio) fileId = fwd.audio.file_id;
                else if (fwd.voice) fileId = fwd.voice.file_id;
                var mediaType = fwd.video ? "video" : fwd.audio ? "audio" : fwd.voice ? "voice" : fwd.photo ? "photo" : "text";
                posts.push({ id, type: mediaType, caption: caption.substring(0, 200), fileId: fileId ? fileId.substring(0, 40) + "..." : null });
                try {
                  await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwd.message_id }) });
                } catch (e2) {
                }
              } else {
                posts.push({ id, error: r.description });
              }
            } catch (e2) {
              posts.push({ id, error: e2.message });
            }
            await new Promise(function(r2) {
              setTimeout(r2, 400);
            });
          }
          return secureJSON({ ok: true, data: posts });
        }
        if (method === "POST" && path === "/api/admin/single-repair") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            if (!body || !body.song_id || !body.url) return err("song_id and url required", 400);
            var songId = parseInt(body.song_id, 10);
            if (!songId || songId < 1) return err("Invalid song_id", 400);
            var target = body.target || "-1004422179990";
            var linkUrl = body.url.trim();
            var mPub = linkUrl.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/);
            var mPriv = linkUrl.match(/t\.me\/c\/(\d+)\/(\d+)/);
            var parsed = mPub ? { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) } : mPriv ? { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) } : null;
            if (!parsed) return err("Invalid t.me link", 400);
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var fwd = await (await fetch(tgBase + "/forwardMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: target, from_chat_id: parsed.channel, message_id: parsed.msgId })
            })).json();
            if (!fwd.ok) return err("forwardMessage failed: " + (fwd.description || "unknown"), 400);
            var fwdMsg = fwd.result;
            var fileId = null, mediaType = null, caption = fwdMsg.caption || fwdMsg.text || "";
            if (fwdMsg.video) {
              fileId = fwdMsg.video.file_id;
              mediaType = "video";
            } else if (fwdMsg.audio) {
              fileId = fwdMsg.audio.file_id;
              mediaType = "audio";
            } else if (fwdMsg.voice) {
              fileId = fwdMsg.voice.file_id;
              mediaType = "audio";
            } else if (fwdMsg.document) {
              fileId = fwdMsg.document.file_id;
              mediaType = "document";
            }
            try {
              await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwdMsg.message_id }) });
            } catch (e2) {
            }
            if (!fileId) return err("No media in message (type: " + (fwdMsg.video ? "video" : fwdMsg.audio ? "audio" : fwdMsg.voice ? "voice" : fwdMsg.document ? "document" : "text/other") + ")", 400);
            var freshUrl = null;
            try {
              var fi = await botAPI.getFile(fileId);
              freshUrl = botAPI.getFileUrl(fi.file_path);
            } catch (e2) {
              return err("getFile failed: " + e2.message, 400);
            }
            var updates = ["tg_file_id=?"];
            var vals = [fileId];
            if (mediaType === "video") {
              updates.push("tg_video_url=?");
              vals.push(freshUrl);
            }
            if (mediaType === "audio") {
              updates.push("suno_audio_url=?");
              vals.push(freshUrl);
            }
            updates.push("telegram_message_id=?");
            vals.push(parsed.msgId);
            vals.push(songId);
            await DB.prepare("UPDATE songs SET " + updates.join(",") + ",updated_at=datetime('now') WHERE id=?").bind(...vals).run();
            slog("info", "single_repair", { songId, mediaType, channelId: parsed.msgId });
            return secureJSON({ ok: true, data: { song_id: songId, file_id: fileId, fresh_url: freshUrl, media_type: mediaType, channel_msg_id: parsed.msgId, caption: caption.substring(0, 200) } });
          } catch (e2) {
            slog("error", "single_repair_error", { error: e2.message });
            return err("Single repair error");
          }
        }
        if (method === "POST" && path === "/api/admin/repair-file-ids") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            var limit = Math.min(parseInt(body && body.limit || "20", 10), 50);
            var channel = body && body.channel || "@shemaxpoetry";
            var target = body && body.target || "@ShemaxPoetryFreeChat";
            var delayMs = parseInt(body && body.delayMs, 10) || 1200;
            var rows = await DB.prepare("SELECT id,telegram_message_id,tg_video_url FROM songs WHERE tg_file_id IS NULL AND telegram_message_id IS NOT NULL AND visible=1 AND tg_video_url IS NOT NULL ORDER BY id ASC LIMIT ?").bind(limit).all();
            var repaired = 0, errors = [];
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            for (var i = 0; i < (rows.results || []).length; i++) {
              var song = rows.results[i];
              try {
                var r = await (await fetch(tgBase + "/forwardMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, from_chat_id: channel, message_id: song.telegram_message_id }) })).json();
                if (r.ok && r.result) {
                  var fwd = r.result;
                  var fileId = null;
                  if (fwd.video) fileId = fwd.video.file_id;
                  else if (fwd.audio) fileId = fwd.audio.file_id;
                  else if (fwd.voice) fileId = fwd.voice.file_id;
                  else if (fwd.document) fileId = fwd.document.file_id;
                  if (fileId) {
                    await DB.prepare("UPDATE songs SET tg_file_id=? WHERE id=?").bind(fileId, song.id).run();
                    repaired++;
                    slog("info", "repair_file_id", { songId: song.id, tgMsgId: song.telegram_message_id, ok: true });
                  } else {
                    errors.push({ songId: song.id, error: "no_file_in_message" });
                  }
                  try {
                    await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwd.message_id }) });
                  } catch (e2) {
                  }
                } else {
                  errors.push({ songId: song.id, error: r.description || "forward_failed" });
                }
              } catch (e2) {
                errors.push({ songId: song.id, error: e2.message });
              }
              await new Promise(function(r2) {
                return setTimeout(r2, delayMs);
              });
            }
            var totalRemaining = await DB.prepare("SELECT COUNT(*) as c FROM songs WHERE tg_file_id IS NULL AND telegram_message_id IS NOT NULL AND visible=1 AND tg_video_url IS NOT NULL").first();
            return secureJSON({ ok: true, data: { repaired, errors: errors.length, remaining: totalRemaining && totalRemaining.c || 0, errorDetails: errors.slice(0, 10) } });
          } catch (e2) {
            slog("error", "repair_error", { error: e2.message });
            return err("Repair error");
          }
        }
        if (method === "POST" && path === "/api/admin/search-suno") {
          try {
            var body = await safeJSON(request);
            if (!body) return err("Invalid JSON", 400);
            var limit = Math.min(parseInt(body.limit || "20", 10), 200);
            var offset = Math.max(parseInt(body.offset || "0", 10), 0);
            var rows = await DB.prepare("SELECT id,title FROM songs WHERE (suno_track_url IS NULL OR suno_track_url='') AND title IS NOT NULL AND title!='' AND title!='Untitled' AND visible=1 ORDER BY published_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all();
            var searched = 0, found = 0;
            for (var i = 0; i < (rows.results || []).length; i++) {
              var song = rows.results[i];
              searched++;
              var full = await DB.prepare("SELECT lyrics FROM songs WHERE id=?").bind(song.id).first();
              if (full && full.lyrics) {
                var urls = sunoExtractUrls(full.lyrics);
                if (urls.length) {
                  for (var j = 0; j < urls.length; j++) {
                    try {
                      var info = await sunoFetch(urls[j]);
                      if (info && info.audioUrl) {
                        await DB.prepare("UPDATE songs SET suno_audio_url=?,suno_cover_url=?,suno_track_url=?,cover_url=COALESCE(?,cover_url),title=? WHERE id=?").bind(info.audioUrl, info.coverUrl, urls[j], info.coverUrl, info.title, song.id).run();
                        found++;
                        break;
                      }
                    } catch (e2) {
                    }
                  }
                }
              }
            }
            return secureJSON({ ok: true, data: { searched, found } });
          } catch (e2) {
            return err("Search Suno error");
          }
        }
        if (method === "GET" && path === "/api/admin/reviews") {
          return secureJSON({ ok: true, data: await d.getPendingReviews() });
        }
        if (method === "POST" && path === "/api/admin/reviews") {
          var body = await safeJSON(request);
          if (!body || !body.id || !body.status) return err("id and status required", 400);
          await d.resolveReview(parseInt(body.id, 10), body.status);
          slog("info", "review_resolved", { reviewId: body.id, status: body.status, requestId });
          return secureJSON({ ok: true });
        }
        if (method === "GET" && path === "/api/admin/link-types") {
          return secureJSON({ ok: true, data: await d.getLinkTypes() });
        }
        if (method === "POST" && path === "/api/admin/link-types") {
          var body = await safeJSON(request);
          if (!body || !body.name) return err("name required", 400);
          if (typeof body.name !== "string" || body.name.length > 100) return err("Invalid name", 400);
          var result = await d.upsertLinkType({ name: body.name, icon: body.icon, sort_order: body.sort_order });
          return secureJSON({ ok: true, data: result }, 201);
        }
        m = path.match(/^\/api\/admin\/link-types\/(\d+)$/);
        if (m && method === "DELETE") {
          await d.deleteLinkType(parseInt(m[1], 10));
          return secureJSON({ ok: true });
        }
        if (method === "GET" && path === "/api/admin/song-links") {
          var songId = safeInt(url.searchParams.get("song_id"), 0);
          if (!songId) return err("song_id required", 400);
          return secureJSON({ ok: true, data: await d.getSongExternalLinks(songId) });
        }
        if (method === "POST" && path === "/api/admin/song-links") {
          var body = await safeJSON(request);
          if (!body || !body.song_id || !body.link_type_id || !body.url) return err("song_id, link_type_id and url required", 400);
          if (typeof body.url !== "string" || body.url.length > 2e3) return err("Invalid url", 400);
          var result = await d.upsertSongLink({
            song_id: parseInt(body.song_id, 10),
            link_type_id: parseInt(body.link_type_id, 10),
            url: body.url,
            description: body.description || null
          });
          return secureJSON({ ok: true, data: result }, 201);
        }
        m = path.match(/^\/api\/admin\/song-links\/(\d+)$/);
        if (m && method === "DELETE") {
          await d.deleteSongLink(parseInt(m[1], 10));
          return secureJSON({ ok: true });
        }
        if (method === "GET" && path === "/api/admin/verify-db") {
          try {
            var pubs = await d.getPublications();
            var stats = await d.getMessageStats();
            var songCount = (await d.getSongs(false, 9999, 0)).length;
            var activeSongCount = (await d.getSongs(true, 9999, 0)).length;
            var withVideo = 0, withAudio = 0, withFile = 0, withSuno = 0, withCover = 0;
            for (var i = 0; i < pubs.length; i++) {
              if (pubs[i].post.file_url) withFile++;
              if (pubs[i].post.msg_type === "video") withVideo++;
              if (pubs[i].post.msg_type === "audio" || pubs[i].post.msg_type === "voice") withAudio++;
              if (pubs[i].song && pubs[i].song.suno_audio_url) withSuno++;
              if (pubs[i].song && (pubs[i].song.cover_url || pubs[i].song.suno_cover_url)) withCover++;
            }
            var totalComments = 0;
            for (var i = 0; i < pubs.length; i++) {
              totalComments += pubs[i].comments.length;
            }
            return secureJSON({
              ok: true,
              data: {
                stats,
                songs: { total: songCount, active: activeSongCount },
                publications: { count: pubs.length, withVideo, withAudio, withMedia: withFile, withSuno, withCover, comments: totalComments }
              }
            });
          } catch (e2) {
            slog("error", "verify_db_error", { error: e2.message, requestId });
            return err("Verify error");
          }
        }
        return err("Not found", 404);
      }
      return err("Not found", 404);
    }
    if (path === "/privacy") {
      return htmlResponse(PRIVACY_HTML);
    }
    var key = path === "/" ? "index.html" : path.substring(1);
    try {
      var isText = key.match(/\.(html|css|js|json|svg|txt)$/);
      var value = await STATIC.get(key, { type: isText ? "text" : "arrayBuffer" });
      if (value === null) {
        if (key.endsWith("/")) key += "index.html";
        else key += "/index.html";
        value = await STATIC.get(key, { type: isText ? "text" : "arrayBuffer" });
        if (value === null) return addSecurityHeaders(new Response("Not found", { status: 404 }));
      }
      var ext = key.substring(key.lastIndexOf("."));
      var ct = mimeTypes[ext] || "application/octet-stream";
      var isHtml = ext === ".html" || ext === ".htm";
      var isAdmin = key.indexOf("admin") !== -1;
      var csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'" + (isAdmin ? " https://challenges.cloudflare.com" : "") + "; img-src 'self' https://api.telegram.org https://cdn1.suno.ai https://cdn2.suno.ai https://poetry.shemaxpoetry.workers.dev https://shemaxpoetry.website.yandexcloud.net https://raw.githubusercontent.com data:; media-src 'self' https://api.telegram.org https://cdn1.suno.ai https://cdn2.suno.ai https://poetry.shemaxpoetry.workers.dev https://shemaxpoetry.website.yandexcloud.net https://raw.githubusercontent.com; connect-src 'self' https://poetry.shemaxpoetry.workers.dev https://cdn1.suno.ai https://shemaxpoetry.website.yandexcloud.net https://raw.githubusercontent.com" + (isAdmin ? " https://challenges.cloudflare.com" : "") + "; font-src 'self';" + (isAdmin ? " frame-src https://challenges.cloudflare.com;" : "");
      if (!isHtml) csp = "";
      var resp = new Response(value, { headers: { "Content-Type": ct, "Cache-Control": "no-cache, must-revalidate" } });
      if (csp) resp.headers.set("Content-Security-Policy", csp);
      return addSecurityHeaders(resp);
    } catch (e2) {
      slog("error", "static_error", { error: e2.message, path });
      return addSecurityHeaders(new Response("Not found", { status: 404 }));
    }
  },
  async scheduled(controller, env) {
    var DB = env.DB;
    try {
      var rows1 = await DB.prepare("SELECT * FROM songs WHERE suno_track_url IS NOT NULL AND (suno_audio_url IS NULL OR suno_audio_url='')").all();
      for (var i = 0; i < (rows1.results || []).length; i++) {
        var song = rows1.results[i];
        try {
          var info = await sunoFetch(song.suno_track_url);
          if (info && info.audioUrl) {
            await DB.prepare("UPDATE songs SET suno_audio_url=?,suno_cover_url=?,title=COALESCE(NULLIF(title,'Untitled'),?),updated_at=datetime('now') WHERE id=?").bind(info.audioUrl, info.coverUrl, info.title, song.id).run();
          }
        } catch (e) {
        }
      }
      var rows2 = await DB.prepare("SELECT * FROM songs WHERE lyrics LIKE '%suno.com%' AND (suno_audio_url IS NULL OR suno_audio_url='')").all();
      for (var i = 0; i < (rows2.results || []).length; i++) {
        var song = rows2.results[i];
        var urls = sunoExtractUrls(song.lyrics);
        for (var j = 0; j < urls.length; j++) {
          try {
            if (song.suno_track_url && song.suno_track_url !== urls[j]) continue;
            var info = await sunoFetch(urls[j]);
            if (info && info.audioUrl) {
              await DB.prepare("UPDATE songs SET suno_audio_url=?,suno_cover_url=?,suno_track_url=?,title=COALESCE(NULLIF(title,'Untitled'),?),updated_at=datetime('now') WHERE id=?").bind(info.audioUrl, info.coverUrl, urls[j], info.title, song.id).run();
              break;
            }
          } catch (e) {
          }
        }
      }
    } catch (e) {
      console.log(JSON.stringify({ service: "poetry", level: "error", msg: "scheduled_error", ts: (/* @__PURE__ */ new Date()).toISOString(), data: { error: e.message } }));
    }
  }
};
export {
  worker_default as default
};
