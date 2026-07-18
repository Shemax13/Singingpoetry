import { safeJSON, cors, corsRestricted, json, jsonRestricted, err, secureJSON, htmlResponse, genToken, safeInt, isAuth, firstLine, sunoExtractUrls, sunoFetch, processSunoUrl, parseMsgFull, mimeTypes, validateText, validateInt, rateLimit, rateLimitResponse, RATE_LIMIT_WINDOW } from './utils.js';

var secureHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

function addSecurityHeaders(resp) {
  for (var k in secureHeaders) resp.headers.set(k, secureHeaders[k]);
  return resp;
}

var PRIVACY_HTML = '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Shemaxpoetry — Политика конфиденциальности</title><style>body{font-family:sans-serif;background:#0d0d14;color:#e8e6e3;max-width:720px;margin:0 auto;padding:40px 20px;line-height:1.6}h1{color:#d4a853}h2{color:#d4a853;font-size:1.2rem;margin-top:24px}a{color:#d4a853}</style></head><body><h1>Политика конфиденциальности</h1><p>Последнее обновление: 6 июля 2026</p><h2>1. Какие данные мы собираем</h2><p>— Тексты и медиафайлы (видео, аудио, изображения) из Telegram-канала @shemaxpoetry и связанного чата.<br>— IP-адрес при запросах к сайту (обрабатывается автоматически инфраструктурой Cloudflare).<br>— Данные для входа в админ-панель (пароль, Turnstile-токен) — не хранятся после проверки.</p><h2>2. Как мы используем данные</h2><p>— Для отображения песен, подкастов и сопутствующего контента на сайте poetry.shemaxpoetry.workers.dev.<br>— Для обеспечения безопасности (rate limiting, защита от ботов).</p><h2>3. Хранение данных</h2><p>— Данные хранятся в Cloudflare D1 (база данных), Cloudflare KV (фронтенд) и Cloudflare R2 (медиафайлы).<br>— Серверы расположены в дата-центрах Cloudflare по всему миру.<br>— Срок хранения: пока сайт функционирует. Для удаления обратитесь к @shemax45 в Telegram.</p><h2>4. Передача данных третьим лицам</h2><p>— Мы не продаём и не передаём данные третьим лицам.<br>— Используется инфраструктура Cloudflare (обработка запросов, хранение).<br>— Медиафайлы могут загружаться с Telegram CDN и GitHub raw.</p><h2>5. Ваши права (GDPR / CCPA)</h2><p>— Право на доступ: запросить копию ваших данных через @shemax45.<br>— Право на удаление: потребовать удаления данных через @shemax45.<br>— Право на исправление: сообщить об ошибках в данных.<br>— Право на ограничение обработки.<br>— Для запросов: @shemax45 в Telegram.</p><h2>6. Файлы cookie</h2><p>— Сайт не использует собственные файлы cookie для отслеживания.<br>— Cloudflare может устанавливать технические cookie (_cfduid и аналоги) в рамках своей инфраструктуры.</p><h2>7. Безопасность</h2><p>— Все соединения защищены HTTPS (TLS 1.2+).<br>— Админ-панель защищена паролем и Cloudflare Turnstile.<br>— Действуют ограничения частоты запросов (rate limiting).</p><h2>8. Контакты</h2><p>По вопросам конфиденциальности: @shemax45 в Telegram.</p></body></html>';
var GITHUB_RAW = "https://raw.githubusercontent.com/Shemax13/Singingpoetry/master/audio/";
var PODCAST_URLS = {};
PODCAST_URLS[394] = GITHUB_RAW + "The thirteenth wave podcast.m4a";
PODCAST_URLS[390] = GITHUB_RAW + "The thirteenth wave podcast.m4a";
PODCAST_URLS[228] = GITHUB_RAW + "Грейпфрут.mp3";
PODCAST_URLS[439] = GITHUB_RAW + "Прогресс_против_безграничной_глупости.m4a";
PODCAST_URLS[448] = GITHUB_RAW + "Ртуть_от_градусника_до_смертельной_угрозы.m4a";
PODCAST_URLS[440] = GITHUB_RAW + "Стихотворение_Шейнина_Бесснежная_зима_и_тревога.m4a";
PODCAST_URLS[226] = GITHUB_RAW + "Как_мир_встречает_Новый_год_от_Испании_до_Японии.m4a";
PODCAST_URLS[231] = GITHUB_RAW + "Максим_Шейнин_Она_художник_Психологическая_драма_стиха.m4a";

import { db } from './db.js';
import { tg } from './services.js';

export default {
  async fetch(request, env) {
    var DB = env.DB;
    var TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    var STATIC = env.STATIC;
    var WEBHOOK_SECRET = env.WEBHOOK_SECRET;
    var ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    var url = new URL(request.url);
    var path = url.pathname;
    var method = request.method;

    // Structured logging
    var requestId = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36);
    function slog(level, msg, data) {
      console.log(JSON.stringify({ service: "poetry", level: level, msg: msg, requestId: requestId, ts: new Date().toISOString(), data: data || {} }));
    }

    if (method === "OPTIONS") return new Response(null, { headers: path.startsWith("/api/admin/") ? corsRestricted : cors });

    if (path.startsWith("/api/")) {
      var d = db(DB);
      var botAPI = tg(TELEGRAM_BOT_TOKEN, STATIC);
      slog("info", "request", { method: method, path: path, requestId: requestId });

      // Rate limit: 100 req/min for public API, 20 req/min for admin (aggregate), 5 req/min for login
      var rlKey = request.headers.get("CF-Connecting-IP") || "unknown";
      var isAdminPath = path.startsWith("/api/admin/");
      var rlScope = path === "/api/admin/login" ? "login" : (isAdminPath ? "admin" : "public");
      var rlMax = path === "/api/admin/login" ? 5 : (isAdminPath ? 20 : 100);
      var rlResp = rateLimitResponse("rl:" + rlKey + ":" + rlScope, rlMax, RATE_LIMIT_WINDOW);
      if (rlResp) {
        slog("warn", "rate_limited", { key: rlKey, path: path });
        return rlResp;
      }

      // -- Public API --
      if (method === "GET" && path === "/api/songs") {
        var songs = await d.getSongs(true, safeInt(url.searchParams.get("limit"), 50), safeInt(url.searchParams.get("offset"), 0));
        var count = await d.getSongsCount(true);
        // Strip internal fields from public response
        var safe = [];
        for (var _si = 0; _si < songs.length; _si++) {
          var s = songs[_si];
          var mediaUrl = null;
          if (s.tg_video_url && !s.tg_video_url.startsWith('local:')) mediaUrl = s.tg_video_url;
          else if (s.suno_audio_url) mediaUrl = s.suno_audio_url;
          safe.push({
            id: s.id, title: s.title, lyrics: s.lyrics, cover_url: s.cover_url,
            suno_cover_url: s.suno_cover_url, tg_video_url: s.tg_video_url,
            suno_audio_url: s.suno_audio_url,
            media_url: mediaUrl,
            podcast_count: s.podcast_count || (PODCAST_URLS[s.id] ? 1 : 0), podcast_audio_url: s.podcast_audio_url || PODCAST_URLS[s.id] || null,
            duration: s.duration, language: s.language, published_at: s.published_at,
            order_index: s.order_index
          });
          // Warm getFile cache in background (don't block response)
          if (s.tg_file_id) botAPI.getFile(s.tg_file_id).catch(function (e) { slog("error", "getFile_warm_failed", { songId: s.id, error: e.message }); });
        }
        return json({ ok: true, data: safe, count: count });
      }

      var m = path.match(/^\/api\/songs\/(\d+)$/);
      if (m && method === "GET") {
        var song = await d.getPublicSong(parseInt(m[1], 10));
        if (!song) return err("Not found", 404);
        var mediaUrl = null;
        if (song.tg_video_url && !song.tg_video_url.startsWith('local:')) mediaUrl = song.tg_video_url;
        else if (song.suno_audio_url) mediaUrl = song.suno_audio_url;
        var safeSong = {
          id: song.id, title: song.title, lyrics: song.lyrics, cover_url: song.cover_url,
          suno_cover_url: song.suno_cover_url, tg_video_url: song.tg_video_url,
          suno_audio_url: song.suno_audio_url,
          media_url: mediaUrl,
          podcast_count: song.podcast_count || (PODCAST_URLS[song.id] ? 1 : 0), podcast_audio_url: song.podcast_audio_url || PODCAST_URLS[song.id] || null,
          duration: song.duration, language: song.language, published_at: song.published_at,
          order_index: song.order_index
        };
        return json({ ok: true, data: safeSong });
      }

      m = path.match(/^\/api\/songs\/(\d+)\/next$/);
      if (m && method === "GET") { var next = await d.getNextSong(parseInt(m[1], 10)); return next ? json({ ok: true, data: next }) : err("No next", 404); }

      m = path.match(/^\/api\/song\/(\d+)\/podcasts$/);
      if (m && method === "GET") {
        var songId = parseInt(m[1], 10);
        var ps = await d.getExtraAudio(songId, 'podcast');
        if (!ps.length && PODCAST_URLS[songId]) {
          ps = [{ id: 0, song_id: songId, title: "Подкаст", file_url: PODCAST_URLS[songId], file_type: "podcast", visible: 1 }];
        }
        return json({ ok: true, data: ps });
      }

      m = path.match(/^\/api\/song\/(\d+)\/links$/);
      if (m && method === "GET") { var links = await d.getSongExternalLinks(parseInt(m[1], 10)); return json({ ok: true, data: links }); }

      m = path.match(/^\/api\/media\/(\d+)$/);
      if (m && method === "GET") {
        try {
          var songId = parseInt(m[1], 10);
          var song = await d.getPublicSong(songId);
          if (!song) return err("Not found", 404);

          var mediaUrl = null;
          // 1. Try tg_file_id (fastest)
          if (song.tg_file_id) { try { var fi = await botAPI.getFile(song.tg_file_id); mediaUrl = botAPI.getFileUrl(fi.file_path); } catch (e) { } }
          // 2. Try tg_message_url (t.me link → forwardMessage → getFile)
          if (!mediaUrl && song.tg_message_url) {
            try {
              var linkUrl = song.tg_message_url;
              var mPub = linkUrl.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/);
              var mPriv = linkUrl.match(/t\.me\/c\/(\d+)\/(\d+)/);
              var parsed = mPub ? { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) } : (mPriv ? { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) } : null);
              if (parsed) {
                var fwdTarget = env.TG_FORWARD_TARGET || "@ShemaxPoetryFreeChat";
                var fwd = await (await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/forwardMessage", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: fwdTarget, from_chat_id: parsed.channel, message_id: parsed.msgId })
                })).json();
                if (fwd.ok && fwd.result) {
                  var fwdMsg = fwd.result;
                  var freshFileId = null;
                  if (fwdMsg.video) freshFileId = fwdMsg.video.file_id;
                  else if (fwdMsg.audio) freshFileId = fwdMsg.audio.file_id;
                  else if (fwdMsg.voice) freshFileId = fwdMsg.voice.file_id;
                  // Delete forwarded message
                  try { await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: fwdTarget, message_id: fwdMsg.message_id }) }); } catch (e) { }
                  if (freshFileId) {
                    var freshFi = await botAPI.getFile(freshFileId);
                    mediaUrl = botAPI.getFileUrl(freshFi.file_path);
                    // Save file_id for faster access next time
                    DB.prepare("UPDATE songs SET tg_file_id=? WHERE id=?").bind(freshFileId, song.id).run().catch(function(){});
                  }
                }
              }
            } catch (e) { }
          }
          // 3. Try tg_message_url via telegram_message_id (forwardMessage → getFile)
          if (!mediaUrl && song.telegram_message_id) {
            try {
              var fwdTarget = env.TG_FORWARD_TARGET || "@ShemaxPoetryFreeChat";
              var fwd = await (await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/forwardMessage", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: fwdTarget, from_chat_id: "@shemaxpoetry", message_id: song.telegram_message_id })
              })).json();
              if (fwd.ok && fwd.result) {
                var fwdMsg = fwd.result;
                var freshFileId = null;
                if (fwdMsg.video) freshFileId = fwdMsg.video.file_id;
                else if (fwdMsg.audio) freshFileId = fwdMsg.audio.file_id;
                else if (fwdMsg.voice) freshFileId = fwdMsg.voice.file_id;
                try { await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: fwdTarget, message_id: fwdMsg.message_id }) }); } catch (e) { }
                if (freshFileId) {
                  var freshFi = await botAPI.getFile(freshFileId);
                  mediaUrl = botAPI.getFileUrl(freshFi.file_path);
                  DB.prepare("UPDATE songs SET tg_file_id=? WHERE id=?").bind(freshFileId, song.id).run().catch(function(){});
                }
              }
            } catch (e) { }
          }
          // 4. Suno audio (only if suno.ai domain)
          if (!mediaUrl && song.suno_audio_url && song.suno_audio_url.indexOf('suno') !== -1) mediaUrl = song.suno_audio_url;
          if (!mediaUrl && (song.podcast_audio_url || PODCAST_URLS[song.id])) mediaUrl = song.podcast_audio_url || PODCAST_URLS[song.id];
          // 5. Last resort: try stale tg_video_url (may still work)
          if (!mediaUrl && song.tg_video_url && !song.tg_video_url.startsWith("local:")) mediaUrl = song.tg_video_url;
          if (!mediaUrl) return err("No media", 404);

          // Redirect the browser to the media URL.
          // The Worker cannot proxy because Cloudflare blocks api.telegram.org from Workers.
          var resp = new Response(null, { status: 302, headers: { "Location": mediaUrl, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" } });
          return addSecurityHeaders(resp);
        } catch (e) { return err("Media error"); }
      }

      // -- Upload video to GitHub raw (admin only) --
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
          for (var c in extMap) { if (contentType.indexOf(c) !== -1) { ext = extMap[c]; break; } }

          var arrayBuffer = await request.arrayBuffer();
          if (arrayBuffer.byteLength > 50 * 1024 * 1024) return err("File too large (max 50MB)", 400);

          var ghPath = "videos/" + songId + ext;
          var rawUrl = "https://raw.githubusercontent.com/Shemax13/Singingpoetry/master/" + ghPath;

          var ghResp = await fetch("https://api.github.com/repos/Shemax13/Singingpoetry/contents/" + ghPath, {
            method: "PUT",
            headers: { "Authorization": "Bearer " + githubToken, "Content-Type": "application/json", "User-Agent": "shemax-poetry-worker" },
            body: JSON.stringify({ message: "cache video #" + songId, content: Buffer.from(arrayBuffer).toString('base64') }),
          });

          var ghResult = await ghResp.json();
          if (!ghResp.ok) {
            slog("error", "github_upload_failed", { songId: songId, status: ghResp.status, error: JSON.stringify(ghResult), requestId: requestId });
            return err("GitHub upload failed");
          }

          await d.upsertSong({ id: songId, tg_video_url: rawUrl });
          slog("info", "github_uploaded", { songId: songId, size: arrayBuffer.byteLength, requestId: requestId });
          return json({ ok: true, data: { url: rawUrl, size: arrayBuffer.byteLength } });
        } catch (e) {
          slog("error", "upload_video_error", { error: e.message, requestId: requestId });
          return err("Upload failed");
        }
      }

      // -- Debug: read last webhook events from KV --
      if (method === "GET" && path === "/api/debug-webhook") {
        var debugData = await STATIC.get("debug:wh:last", { type: "json" }) || [];
        return json({ ok: true, data: debugData });
      }
      // -- Debug: check getUpdates for pending messages --
      if (method === "GET" && path === "/api/debug-getupdates") {
        if (!await isAuth(request, DB)) return err("Unauthorized", 401);
        var ac = new AbortController();
        setTimeout(function() { ac.abort(); }, 10000);
        var resp = await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/getUpdates?limit=10&timeout=0", { signal: ac.signal });
        var data = await resp.json();
        return json({ ok: true, data: data });
      }

      // -- Webhook --
      if (method === "POST" && path === "/api/webhook") {
        try {
          if (rateLimit("rl:wh:" + url.searchParams.get("secret") || "anon", 30, RATE_LIMIT_WINDOW)) return json({ ok: true });
          var whSecret = url.searchParams.get("secret") || "";
          if (WEBHOOK_SECRET && whSecret !== WEBHOOK_SECRET) {
            slog("warn", "webhook_invalid_secret", { requestId: requestId });
            return json({ ok: true });
          }
          var raw = await request.text();
          if (!raw || raw.length > 100000) {
            slog("warn", "webhook_invalid_body", { length: (raw || "").length, requestId: requestId });
            return json({ ok: true });
          }
          var update;
          try { update = JSON.parse(raw); } catch (e) { return json({ ok: true }); }
          var p = parseMsgFull(update);
          // KV-based debug: store last 5 webhook events so we can query them via GET /api/debug-webhook
          try {
            var debugKey = "debug:wh:last";
            var existing = await STATIC.get(debugKey, { type: "json" }) || [];
            existing.unshift({ ts: new Date().toISOString(), chatType: p ? p.chat_type : null, msgType: p ? p.msg_type : null, text: p ? (p.text_content || "").substring(0, 200) : null, fileId: p ? p.file_id : null, fwdChat: p ? p.forward_from_chat_id : null, fwdMsg: p ? p.forward_from_msg_id : null, fileName: p ? p.file_name : null, hasAudio: p ? !!(update.message && update.message.audio) : null });
            if (existing.length > 5) existing = existing.slice(0, 5);
            await STATIC.put(debugKey, JSON.stringify(existing), { expirationTtl: 3600 });
          } catch (debugErr) { slog("error", "debug_store_failed", { error: debugErr.message, requestId: requestId }); }
          if (!p || !p.tg_msg_id) return json({ ok: true });
          if (!p.chat_type || !p.text_content || p.text_content.length > 5000) p.text_content = (p.text_content || "").substring(0, 5000);

          // Dedup: skip if this exact message already stored
          var existingMsg = await d.getMessageByChatAndMsg(p.chat_id, p.tg_msg_id);
          if (existingMsg) {
            slog("info", "webhook_dup_msg", { tgMsgId: p.tg_msg_id, chat: p.chat_id, requestId: requestId });
            return json({ ok: true });
          }

          if (p.chat_type === "channel" || p.chat_type === "group") {
            var msgId = await d.storeMessage(p);
            if (msgId && p.forward_from_chat_id && p.forward_from_msg_id && p.file_id) {
              try { var fileInfo = await botAPI.getFile(p.file_id); p.file_url = botAPI.getFileUrl(fileInfo.file_path); } catch (e) { }
            }
            if (msgId && p.file_url) {
              await DB.prepare("UPDATE messages SET file_url=? WHERE id=?").bind(p.file_url, msgId).run();
            }
          }
          var msgIdForDedup = p.forward_from_msg_id || p.tg_msg_id;
          var isSong = (p.msg_type === "video" || p.msg_type === "audio" || (p.msg_type === "document" && p.mime_type && p.mime_type.startsWith("audio/"))) && p.file_id;
          var songObj = null;

          // Podcast audio detection: audio forwarded from known sources → match to existing song
          // Triggers on: (1) caption contains "подкаст", OR (2) forwarded from podcast channels, OR (3) filename matches known podcast patterns
          var isPodcastFwd = isSong && (p.msg_type === "audio" || p.msg_type === "voice") && p.forward_from_chat_id && (p.forward_from_chat_id === "@shemaxpoetry" || p.forward_from_chat_id === "@ShemaxPoetryFreeChat");
          var hasPodcastCaption = isSong && p.text_content && /подкаст/i.test(p.text_content);
          var hasPodcastFilename = isSong && p.file_name && /подкаст|podcast/i.test(p.file_name);
          if (isPodcastFwd || hasPodcastCaption || hasPodcastFilename) {
            try {
              var fileInfo;
              try { fileInfo = await botAPI.getFile(p.file_id); } catch (e) { fileInfo = null; }
              var podcastUrl = fileInfo ? botAPI.getFileUrl(fileInfo.file_path) : null;
              // Extract full podcast name (text after "подкаст") from caption
              var podcastDesc = (p.text_content || "").replace(/.*подкаст/i, '').trim().substring(0, 200);
              var updated = false;
              // Strategy 1: Match by podcast_file column (exact filename match — most reliable)
              if (p.file_name) {
                var rows = await DB.prepare("SELECT id, podcast_name FROM songs WHERE podcast_file=?").bind(p.file_name).all();
                if (rows.results && rows.results.length > 0) {
                  var songId = rows.results[0].id;
                  var sets = ["podcast_link=?"];
                  var params = [podcastUrl || p.file_id];
                  if (p.file_id) { sets.push("podcast_file_id=?"); params.push(p.file_id); }
                  if (podcastDesc && !rows.results[0].podcast_name) { sets.push("podcast_name=?"); params.push(podcastDesc); }
                  params.push(songId);
                  await DB.prepare("UPDATE songs SET " + sets.join(",") + " WHERE id=?").bind(...params).run();
                  slog("info", "webhook_podcast_matched_file", { songId: songId, file: p.file_name, requestId: requestId });
                  updated = true;
                }
              }
              // Strategy 2: Match by title from caption quotes
              if (!updated) {
                var titleMatch = (p.text_content || "").match(/["\u00ab]([^"\u00bb]+)["\u00bb]/);
                var podcastName = titleMatch ? titleMatch[1].trim() : null;
                if (!podcastName && p.file_name) {
                  var fnClean = p.file_name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
                  podcastName = fnClean || null;
                }
                if (podcastName) {
                  var rows2 = await DB.prepare("SELECT id, podcast_name FROM songs WHERE title LIKE ? OR full_title LIKE ?").bind("%" + podcastName + "%", "%" + podcastName + "%").all();
                  if (rows2.results && rows2.results.length > 0) {
                    var songId = rows2.results[0].id;
                    var sets = ["podcast_link=?"];
                    var params = [podcastUrl || p.file_id];
                    if (p.file_id) { sets.push("podcast_file_id=?"); params.push(p.file_id); }
                    if (podcastDesc && !rows2.results[0].podcast_name) { sets.push("podcast_name=?"); params.push(podcastDesc); }
                    params.push(songId);
                    await DB.prepare("UPDATE songs SET " + sets.join(",") + " WHERE id=?").bind(...params).run();
                    slog("info", "webhook_podcast_matched_title", { songId: songId, podcastName: podcastName, requestId: requestId });
                    updated = true;
                  }
                }
              }
              if (!updated) {
                slog("info", "webhook_podcast_unmatched", { file: p.file_name || "", text: (p.text_content || "").substring(0, 100), requestId: requestId });
              }
              return json({ ok: true });
            } catch (pe) { slog("error", "webhook_podcast_error", { error: pe.message, requestId: requestId }); }
          }

          if (isSong) {
            // Dedup: skip if song already exists for this telegram message
            if (await d.getByTgMsg(msgIdForDedup)) {
              slog("info", "webhook_dup_song", { tgMsgId: msgIdForDedup, requestId: requestId });
              return json({ ok: true });
            }
            var fileInfo;
            try { fileInfo = await botAPI.getFile(p.file_id); } catch (e) { return json({ ok: true }); }
            songObj = { title: firstLine(p.text_content), lyrics: p.text_content || null, telegram_message_id: msgIdForDedup, published_at: p.published_at };
            if (p.msg_type === "video") {
              songObj.tg_video_url = botAPI.getFileUrl(fileInfo.file_path);
              songObj.tg_file_id = p.file_id;
            } else {
              songObj.suno_audio_url = botAPI.getFileUrl(fileInfo.file_path);
            }
            await d.upsertSong(songObj);
            slog("info", "webhook_song_created", { tgMsgId: msgIdForDedup, title: songObj.title, requestId: requestId });
          }
          var sunoUrls = sunoExtractUrls(p.text_content);
          if (sunoUrls.length) {
            var targetSongId = null;
            if (songObj) { var tmp = await d.getByTgMsg(msgIdForDedup); if (tmp) targetSongId = tmp.id; }
            if (!targetSongId && p.forward_from_msg_id) { var tmp = await d.getByTgMsg(p.forward_from_msg_id); if (tmp) targetSongId = tmp.id; }
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
                slog("info", "webhook_suno_attached", { songId: targetSongId, sunoUrl: sunoUrls[si], requestId: requestId });
              }
            }
          }
          return json({ ok: true });
        } catch (e) { slog("error", "webhook_error", { error: e.message, requestId: requestId }); return json({ ok: true }); }
      }

      // -- Admin login --
      if (method === "POST" && path === "/api/admin/login") {
        var body = await safeJSON(request);
        if (!body || !body.password || typeof body.password !== "string" || body.password.length > 256) return err("Password required", 400);
        // Turnstile verification (optional — only if token provided)
        var turnstileToken = body.turnstile_token || "";
        if (turnstileToken) {
          var verifyResp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken }),
          });
          var verifyData = await verifyResp.json();
          if (!verifyData.success) return err("CAPTCHA verification failed", 400);
        }
        if (body.password === ADMIN_PASSWORD) {
          var token = genToken();
          var exp = new Date(Date.now() + 86400000).toISOString();
          await d.createSession(token, exp);
          return secureJSON({ ok: true, data: { token: token } });
        }
        await new Promise(function (r) { return setTimeout(r, 1000); });
        return err("Invalid password", 401);
      }

      // -- Privacy policy (public, no auth) --
      if (path === "/api/privacy") {
        return htmlResponse(PRIVACY_HTML);
      }

      // -- Admin routes --
      if (path.startsWith("/api/admin/")) {
        if (!await isAuth(request, DB)) return err("Unauthorized", 401);

        if (method === "GET" && path === "/api/admin/songs") return secureJSON({ ok: true, data: await d.getSongs(false, 9999, 0) });
        if (method === "POST" && path === "/api/admin/songs") {
          var body = await safeJSON(request);
          if (!body || body.title === undefined && body.lyrics === undefined) return err("title or lyrics required", 400);
          if (body.id) return err("Use PUT /api/admin/songs/:id to update", 400);
          if (body.title && typeof body.title === "string" && body.title.length > 500) return err("title too long", 400);
          if (body.lyrics && typeof body.lyrics === "string" && body.lyrics.length > 50000) return err("lyrics too long", 400);
          return secureJSON({ ok: true, data: await d.upsertSong(body) }, 201);
        }
        if (method === "PUT" && path === "/api/admin/songs") {
          var body = await safeJSON(request);
          if (!body) return err("Invalid JSON", 400);
          if (body.ids) {
            if (!Array.isArray(body.ids) || body.ids.length > 1000) return err("Invalid ids", 400);
            for (var _idi = 0; _idi < body.ids.length; _idi++) { if (typeof body.ids[_idi] !== "number" || body.ids[_idi] < 1) return err("Invalid ids", 400); }
            await d.reorderSongs(body.ids);
            return secureJSON({ ok: true });
          }
          return err("Invalid", 400);
        }
        m = path.match(/^\/api\/admin\/songs\/(\d+)$/);
        if (m && method === "GET") { var song = await d.getSong(parseInt(m[1], 10)); return song ? secureJSON({ ok: true, data: song }) : err("Not found", 404); }
        if (m && method === "PUT") {
          var body = await safeJSON(request);
          if (!body) return err("Invalid JSON", 400);
          body.id = parseInt(m[1], 10);
          if (!body.id) return err("Invalid song id", 400);
          if (body.title && typeof body.title === "string" && body.title.length > 500) return err("title too long", 400);
          if (body.lyrics && typeof body.lyrics === "string" && body.lyrics.length > 50000) return err("lyrics too long", 400);
          return secureJSON({ ok: true, data: await d.upsertSong(body) });
        }
        if (m && method === "DELETE") { await d.deleteSong(parseInt(m[1], 10)); return secureJSON({ ok: true }); }

        m = path.match(/^\/api\/admin\/songs\/(\d+)\/extra-audio$/);
        if (m && method === "GET") { var audio = await d.getExtraAudio(parseInt(m[1], 10)); return secureJSON({ ok: true, data: audio }); }

        if (method === "GET" && path === "/api/admin/audio-files") {
          var rows = await DB.prepare("SELECT id,forward_from_msg_id,text_content,file_url,file_id,msg_type,duration,file_size,published_at FROM messages WHERE chat_type='group' AND msg_type='audio' AND file_url IS NOT NULL ORDER BY published_at DESC LIMIT 200").all();
          return secureJSON({ ok: true, data: (rows.results || []) });
        }

        if (method === "POST" && path === "/api/admin/extra-audio") {
          var body = await safeJSON(request);
          if (!body || !body.song_id) return err("song_id required", 400);
          if (body.file_url && typeof body.file_url === "string" && body.file_url.length > 2000) return err("file_url too long", 400);
          var songId = parseInt(body.song_id, 10);
          if (isNaN(songId) || songId < 1) return err("Invalid song_id", 400);
          var result = await d.upsertExtraAudio({
            song_id: songId,
            title: body.title || null,
            file_url: body.file_url || null,
            file_type: body.file_type || 'podcast',
            source: body.source || 'telegram',
            telegram_message_id: body.telegram_message_id ? parseInt(body.telegram_message_id, 10) : null,
            duration: body.duration ? parseInt(body.duration, 10) : null,
          });
          slog("info", "extra_audio_created", { songId: songId, id: result.id, requestId: requestId });
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
        if (m && method === "DELETE") { await d.deleteExtraAudio(parseInt(m[1], 10)); return secureJSON({ ok: true }); }

        if (method === "POST" && path === "/api/admin/resolve-podcast-files") {
          var rows = await DB.prepare("SELECT id,file_id FROM messages WHERE chat_type='group' AND msg_type='audio' AND file_id IS NOT NULL AND file_url IS NULL LIMIT 50").all();
          var resolved = 0;
          for (var ri = 0; ri < (rows.results || []).length; ri++) {
            var msg = rows.results[ri];
            try { var fi = await botAPI.getFile(msg.file_id); await DB.prepare("UPDATE messages SET file_url=? WHERE id=?").bind(botAPI.getFileUrl(fi.file_path), msg.id).run(); resolved++; } catch (ex) { }
          }
          return secureJSON({ ok: true, data: { resolved: resolved, remaining: (rows.results || []).length - resolved } });
        }

        // Debug: get webhook info from Telegram
        if (method === "GET" && path === "/api/admin/webhook-info") {
          try {
            var tgBase2 = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var info = await (await fetch(tgBase2 + "/getWebhookInfo")).json();
            return secureJSON({ ok: true, data: info.result || info });
          } catch (e) { return err("Failed: " + e.message); }
        }

        if (method === "POST" && path === "/api/admin/setup-webhook") {
          try {
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var whUrl = url.searchParams.get("url") || ("https://poetry.shemaxpoetry.workers.dev/api/webhook" + (WEBHOOK_SECRET ? "?secret=" + WEBHOOK_SECRET : ""));
            if (whUrl.length > 500) return err("Invalid URL", 400);
            var meResp = await (await fetch(tgBase + "/getMe")).json();
            if (!meResp.ok) return secureJSON({ ok: true, data: { error: "Bot token invalid" } });
            // Delete first to force re-setup
            await fetch(tgBase + "/deleteWebhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
            var tgResp = await (await fetch(tgBase + "/setWebhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: whUrl, allowed_updates: ["message", "channel_post"] }) })).json();
            return secureJSON({ ok: true, data: { me: meResp.result, webhook: tgResp, url: whUrl } });
          } catch (e) { return err("Webhook setup failed"); }
        }

        if (method === "POST" && path === "/api/admin/import-channel") {
          try {
            var body = await safeJSON(request);
            if (!body || !body.channel || !body.message_ids) return err("channel and message_ids required", 400);
            if (body.channel.length > 100 || body.message_ids.length > 5000) return err("Invalid input", 400);
            var ids = [];
            var parts = body.message_ids.split(",");
            for (var k = 0; k < parts.length; k++) {
              var p = parts[k].trim();
              var range = p.split("-");
              if (range.length === 2) { var s = parseInt(range[0], 10), e = parseInt(range[1], 10); if (!isNaN(s) && !isNaN(e) && s > 0 && e > 0 && s <= e && e - s < 100) for (var n = s; n <= e; n++) ids.push(n); }
              else { var n = parseInt(p, 10); if (!isNaN(n) && n > 0) ids.push(n); }
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
              } catch (e) { errors.push({ id: ids[k], error: "Request failed" }); }
              await new Promise(function (r) { return setTimeout(r, 300); });
            }
            return secureJSON({ ok: true, data: { imported: imported, errors: errors } });
          } catch (e) { return err("Import error"); }
        }

        if (method === "POST" && path === "/api/admin/sync") {
          var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
          var whInfo = await (await fetch(tgBase + "/getWebhookInfo")).json();
          var oldUrl = whInfo.ok ? whInfo.result.url : null;
          try {
            if (oldUrl) await fetch(tgBase + "/deleteWebhook", { method: "POST" });
            await new Promise(function (r) { return setTimeout(r, 200); });
            var updates = await (await fetch(tgBase + "/getUpdates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeout: 5, allowed_updates: ["message", "channel_post"] }) })).json();
            var synced = 0;
            if (updates.ok && updates.result) {
              for (var i = 0; i < updates.result.length; i++) {
                var p = parseMsgFull(updates.result[i]);
                if (!p || !p.tg_msg_id) continue;
                await d.storeMessage(p);
                var isSong = (p.msg_type === "video" || p.msg_type === "audio" || (p.msg_type === "document" && p.mime_type && p.mime_type.startsWith("audio/"))) && p.file_id;
                var msgId = p.forward_from_msg_id || p.tg_msg_id;
                if (isSong && !(await d.getByTgMsg(msgId))) {
                  var fileInfo;
                  try { fileInfo = await botAPI.getFile(p.file_id); } catch (e) { continue; }
                  var songObj = { title: firstLine(p.text_content), lyrics: p.text_content || null, telegram_message_id: msgId, published_at: p.published_at };
                  if (p.msg_type === "video") { songObj.tg_video_url = botAPI.getFileUrl(fileInfo.file_path); songObj.tg_file_id = p.file_id; }
                  else songObj.suno_audio_url = botAPI.getFileUrl(fileInfo.file_path);
                  await d.upsertSong(songObj);
                  synced++;
                }
              }
            }
            return secureJSON({ ok: true, data: { synced: synced } });
          } catch (e) { return err("Sync error"); } finally {
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
          } catch (e) { return err("Suno error"); }
        }

        if (method === "POST" && path === "/api/admin/daily-sync") {
          try {
            var checked = 0, updated = 0, errCount = 0;
            var rows1 = await DB.prepare("SELECT id,suno_track_url FROM songs WHERE suno_track_url IS NOT NULL AND (suno_audio_url IS NULL OR suno_audio_url='')").all();
            for (var i = 0; i < (rows1.results || []).length; i++) {
              var song = rows1.results[i]; checked++;
              try {
                var info = await sunoFetch(song.suno_track_url);
                if (info && info.audioUrl) {
                  await DB.prepare("UPDATE songs SET suno_audio_url=?,suno_cover_url=?,title=COALESCE(NULLIF(title,'Untitled'),?),updated_at=datetime('now') WHERE id=?").bind(info.audioUrl, info.coverUrl, info.title, song.id).run();
                  updated++;
                }
              } catch (e) { errCount++; }
            }
            var rows2 = await DB.prepare("SELECT id,lyrics,suno_track_url FROM songs WHERE lyrics LIKE '%suno.com%' AND (suno_audio_url IS NULL OR suno_audio_url='')").all();
            for (var i = 0; i < (rows2.results || []).length; i++) {
              var song = rows2.results[i]; checked++;
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
                } catch (e) { errCount++; }
              }
            }
            return secureJSON({ ok: true, data: { checked: checked, updated: updated, errors: errCount } });
          } catch (e) { return err("Daily sync error"); }
        }

        if (method === "POST" && path === "/api/admin/scan-channel") {
          try {
            var body = await safeJSON(request);
            if (!body) return err("Invalid JSON", 400);
            var channel = body.channel || "@shemaxpoetry";
            if (channel.length > 100 || (typeof body.from !== "undefined" && (isNaN(parseInt(body.from, 10)) || parseInt(body.from, 10) < 1))) return err("Invalid parameters", 400);
            var fromId = parseInt(body.from, 10) || 2;
            var toId = parseInt(body.to, 10) || 2000;
            if (toId - fromId > 10000) return err("Range too large (max 10000)", 400);
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
                    tg_msg_id: fwd.message_id, chat_id: target, chat_type: "group", msg_type: "text",
                    text_content: fwd.caption || fwd.text || null, file_id: null, file_unique_id: null, file_url: null,
                    mime_type: null, file_size: null, duration: null, file_name: null, cover_file_id: null,
                    forward_from_chat_id: channel, forward_from_msg_id: id,
                    reply_to_msg_id: null, reply_to_chat_id: null,
                    published_at: new Date((fwd.date || 0) * 1000).toISOString(),
                  };
                  if (fwd.video) {
                    msgData.msg_type = "video"; msgData.file_id = fwd.video.file_id; msgData.file_unique_id = fwd.video.file_unique_id;
                    msgData.mime_type = fwd.video.mime_type || null; msgData.file_size = fwd.video.file_size || null; msgData.duration = fwd.video.duration || null;
                    if (fwd.video.thumbnail) msgData.cover_file_id = fwd.video.thumbnail.file_id;
                  }
                  else if (fwd.audio) {
                    msgData.msg_type = "audio"; msgData.file_id = fwd.audio.file_id; msgData.file_unique_id = fwd.audio.file_unique_id;
                    msgData.mime_type = fwd.audio.mime_type || null; msgData.file_size = fwd.audio.file_size || null; msgData.duration = fwd.audio.duration || null;
                    msgData.file_name = fwd.audio.file_name || null;
                  }
                  else if (fwd.voice) {
                    msgData.msg_type = "voice"; msgData.file_id = fwd.voice.file_id; msgData.file_unique_id = fwd.voice.file_unique_id;
                    msgData.mime_type = "audio/ogg"; msgData.file_size = fwd.voice.file_size || null; msgData.duration = fwd.voice.duration || null;
                  }
                  else if (fwd.photo && fwd.photo.length) {
                    msgData.msg_type = "photo"; var bp = fwd.photo[fwd.photo.length - 1]; msgData.file_id = bp.file_id; msgData.file_unique_id = bp.file_unique_id;
                    msgData.cover_file_id = bp.file_id;
                  }
                  else if (fwd.document) {
                    msgData.msg_type = "document"; msgData.file_id = fwd.document.file_id; msgData.file_unique_id = fwd.document.file_unique_id;
                    msgData.mime_type = fwd.document.mime_type || null; msgData.file_size = fwd.document.file_size || null;
                  }
                  await d.storeMessage(msgData);
                } else {
                  consecutiveEmpty++;
                  if (consecutiveEmpty >= maxEmpties) break;
                }
              } catch (e) {
                consecutiveEmpty++;
                errors.push({ id: id, error: e.message });
                if (consecutiveEmpty >= maxEmpties) break;
              }
              await new Promise(function (r) { return setTimeout(r, delayMs); });
            }
            return secureJSON({ ok: true, data: { found: found, count: found.length, scannedUpTo: found.length ? found[found.length - 1] : fromId, nextFrom: found.length ? found[found.length - 1] + 1 : fromId } });
          } catch (e) { slog("error", "scan_error", { error: e.message, requestId: requestId }); return err("Scan error"); }
        }

        if (method === "GET" && path === "/api/admin/publications") {
          try {
            var pubs = await d.getPublications();
            return secureJSON({ ok: true, data: pubs });
          } catch (e) { slog("error", "publications_error", { error: e.message, requestId: requestId }); return err("Publications error"); }
        }

        if (method === "GET" && path === "/api/admin/messages") {
          try {
            var chatType = url.searchParams.get("chat_type") || null;
            if (chatType && !["channel", "group"].includes(chatType)) return err("Invalid chat_type", 400);
            var limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
            var offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
            var msgs = await d.getMessages(chatType, limit, offset);
            var stats = await d.getMessageStats();
            return secureJSON({ ok: true, data: { messages: msgs, stats: stats } });
          } catch (e) { slog("error", "messages_error", { error: e.message, requestId: requestId }); return err("Messages error"); }
        }

        if (method === "POST" && path === "/api/admin/resolve-files") {
          try {
            var body = await safeJSON(request);
            var limit = Math.min(parseInt((body && body.limit) || "50", 10), 200);
            var rows = await DB.prepare("SELECT id,file_id FROM messages WHERE file_id IS NOT NULL AND file_url IS NULL LIMIT ?").bind(limit).all();
            var resolved = 0;
            for (var i = 0; i < (rows.results || []).length; i++) {
              var msg = rows.results[i];
              try { var fi = await botAPI.getFile(msg.file_id); await DB.prepare("UPDATE messages SET file_url=? WHERE id=?").bind(botAPI.getFileUrl(fi.file_path), msg.id).run(); resolved++; } catch (ex) { }
            }
            return secureJSON({ ok: true, data: { resolved: resolved, remaining: limit - resolved } });
          } catch (e) { slog("error", "resolve_error", { error: e.message, requestId: requestId }); return err("Resolve error"); }
        }

        if (method === "POST" && path === "/api/admin/resolve-covers") {
          try {
            var body = await safeJSON(request);
            var limit = Math.min(parseInt((body && body.limit) || "100", 10), 200);
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
              } catch (ex) { }
            }
            return secureJSON({ ok: true, data: { resolved: resolved, remaining: (rows.results || []).length - resolved } });
          } catch (e) { slog("error", "resolve_covers_error", { error: e.message, requestId: requestId }); return err("Resolve covers error"); }
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
                var title = firstLine(msg.text_content) || ("Song #" + msg.forward_from_msg_id);
                var songData = { title: title, lyrics: msg.text_content || null, telegram_message_id: msg.forward_from_msg_id, published_at: msg.published_at };
                if (msg.msg_type === "video") {
                  songData.tg_file_id = msg.file_id;
                  try { var fi = await botAPI.getFile(msg.file_id); songData.tg_video_url = botAPI.getFileUrl(fi.file_path); } catch (e) { }
                } else if (msg.msg_type === "audio" || msg.msg_type === "voice") {
                  try { var fi = await botAPI.getFile(msg.file_id); songData.suno_audio_url = botAPI.getFileUrl(fi.file_path); } catch (e) { }
                }
                if (msg.cover_url) songData.cover_url = msg.cover_url;
                await d.upsertSong(songData);
                created++;
              } catch (e) { }
            }
            var remaining = await DB.prepare("SELECT COUNT(DISTINCT m.forward_from_msg_id) as c FROM messages m LEFT JOIN songs s ON s.telegram_message_id=m.forward_from_msg_id WHERE m.forward_from_msg_id IS NOT NULL AND m.file_id IS NOT NULL AND (m.msg_type='video' OR m.msg_type='audio' OR m.msg_type='voice') AND s.id IS NULL").first();
            return secureJSON({ ok: true, data: { created: created, remaining: (remaining && remaining.c) || 0 } });
          } catch (e) { return err("Create songs error"); }
        }

        // Debug: check bot connectivity
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
            // Get webhook info and pending updates
            webhookInfo = await (await fetch(tgBase + "/getWebhookInfo")).json();
            // Get pending updates — offset=0 gets all without consuming
            var pendingUpdates = await (await fetch(tgBase + "/getUpdates?offset=0&limit=100")).json();
            var dropPending = url.searchParams.get("drop_pending");
            if (dropPending === "true") {
              // Clear all pending by setting offset past last
              if (pendingUpdates.ok && pendingUpdates.result.length > 0) {
                var lastId = pendingUpdates.result[pendingUpdates.result.length - 1].update_id;
                await (await fetch(tgBase + "/getUpdates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: lastId + 1 }) })).json();
              }
            }
          }
          return secureJSON({ ok: true, data: { me: me, chat: chatInfo, join: joinResult, webhook: webhookInfo, pendingUpdates: pendingUpdates } });
        }

        // Resolve a t.me link to fresh file_id + URL, save to song
        if (method === "POST" && path === "/api/admin/resolve-tg-link") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            if (!body || !body.url) return err("url required", 400);
            var target = body.target || "@ShemaxPoetryFreeChat";
            var songId = parseInt(body.song_id, 10) || null;

            // Parse t.me link
            var linkUrl = body.url.trim();
            var parsed = null;
            var mPub = linkUrl.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/);
            var mPriv = linkUrl.match(/t\.me\/c\/(\d+)\/(\d+)/);
            if (mPub) parsed = { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) };
            else if (mPriv) parsed = { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) };
            if (!parsed) return err("Invalid t.me link format", 400);

            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;

            // Forward message to target chat
            var fwd = await (await fetch(tgBase + "/forwardMessage", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: target, from_chat_id: parsed.channel, message_id: parsed.msgId })
            })).json();

            if (!fwd.ok) return err("forwardMessage failed: " + (fwd.description || "unknown"), 400);

            var fwdMsg = fwd.result;
            var fileId = null, freshUrl = null, mediaType = null;
            if (fwdMsg.video) { fileId = fwdMsg.video.file_id; mediaType = "video"; }
            else if (fwdMsg.audio) { fileId = fwdMsg.audio.file_id; mediaType = "audio"; }
            else if (fwdMsg.voice) { fileId = fwdMsg.voice.file_id; mediaType = "audio"; }
            else if (fwdMsg.document) { fileId = fwdMsg.document.file_id; mediaType = "document"; }

            // Delete forwarded message
            try { await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwdMsg.message_id }) }); } catch (e) { }

            if (!fileId) return err("No media in message", 400);

            // Get fresh URL via getFile
            try {
              var fi = await botAPI.getFile(fileId);
              freshUrl = botAPI.getFileUrl(fi.file_path);
            } catch (e) { return err("getFile failed: " + e.message, 400); }

            // Save to song if songId provided
            if (songId) {
              var updates = ["tg_file_id=?"];
              var vals = [fileId];
              if (mediaType === "video") {
                updates.push("tg_video_url=?"); vals.push(freshUrl);
              }
              vals.push(songId);
              await DB.prepare("UPDATE songs SET " + updates.join(",") + ",updated_at=datetime('now') WHERE id=?").bind(...vals).run();
            }

            return secureJSON({ ok: true, data: {
              file_id: fileId, fresh_url: freshUrl, media_type: mediaType,
              channel: parsed.channel, msg_id: parsed.msgId, song_id: songId
            }});
          } catch (e) { slog("error", "resolve_tg_link_error", { error: e.message }); return err("Resolve error"); }
        }

        // Batch resolve t.me links for multiple songs
        if (method === "POST" && path === "/api/admin/batch-resolve-tg") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            var target = body.target || "@ShemaxPoetryFreeChat";
            var limit = Math.min(parseInt(body.limit || "10", 10), 50);
            var delayMs = parseInt(body.delayMs, 10) || 1500;
            var dryRun = !!body.dry_run;

            // Get songs with tg_message_url but no tg_file_id
            var songs = await DB.prepare("SELECT id,tg_message_url,tg_file_id FROM songs WHERE tg_message_url IS NOT NULL AND tg_file_id IS NULL AND visible=1 LIMIT ?").bind(limit).all();
            var resolved = 0, errors = [];
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;

            for (var i = 0; i < (songs.results || []).length; i++) {
              var song = songs.results[i];
              var linkUrl = song.tg_message_url;
              var mPub = linkUrl.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/);
              var mPriv = linkUrl.match(/t\.me\/c\/(\d+)\/(\d+)/);
              var parsed = mPub ? { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) } : (mPriv ? { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) } : null);
              if (!parsed) { errors.push({ songId: song.id, error: "invalid_link" }); continue; }

              try {
                var fwd = await (await fetch(tgBase + "/forwardMessage", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: target, from_chat_id: parsed.channel, message_id: parsed.msgId })
                })).json();
                if (!fwd.ok) { errors.push({ songId: song.id, error: fwd.description || "forward_failed" }); continue; }

                var fwdMsg = fwd.result;
                var fileId = null;
                if (fwdMsg.video) fileId = fwdMsg.video.file_id;
                else if (fwdMsg.audio) fileId = fwdMsg.audio.file_id;
                else if (fwdMsg.voice) fileId = fwdMsg.voice.file_id;

                // Delete forwarded message
                try { await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwdMsg.message_id }) }); } catch (e) { }

                if (!fileId) { errors.push({ songId: song.id, error: "no_media" }); continue; }

                if (!dryRun) {
                  await DB.prepare("UPDATE songs SET tg_file_id=?,updated_at=datetime('now') WHERE id=?").bind(fileId, song.id).run();
                }
                resolved++;
              } catch (e) { errors.push({ songId: song.id, error: e.message }); }

              if (i < songs.results.length - 1) await new Promise(function (r) { return setTimeout(r, delayMs); });
            }

            var remaining = await DB.prepare("SELECT COUNT(*) as c FROM songs WHERE tg_message_url IS NOT NULL AND tg_file_id IS NULL AND visible=1").first();
            return secureJSON({ ok: true, data: { resolved: resolved, errors: errors.length, remaining: (remaining && remaining.c) || 0, dryRun: dryRun, errorDetails: errors.slice(0, 20) }});
          } catch (e) { slog("error", "batch_resolve_error", { error: e.message }); return err("Batch resolve error"); }
        }

        // Debug: check if tg_video_url is still reachable
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
              } catch (e) { results.push({ id: s.id, error: e.message, url: s.tg_video_url.substring(0, 80) + "..." }); }
            }
            return secureJSON({ ok: true, data: results });
          } catch (e) { return err("Check error"); }
        }

        // Scan Telegram channel + match messages to songs by title, update tg_file_id and telegram_message_id
        if (method === "POST" && path === "/api/admin/scan-and-repair") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            if (!body) return err("Invalid JSON", 400);
            var channel = body.channel || "@shemaxpoetry";
            var target = body.target || "@ShemaxPoetryFreeChat";
            var fromId = parseInt(body.from, 10) || 1;
            var toId = parseInt(body.to, 10) || 2000;
            if (toId - fromId > 10000) return err("Range too large", 400);
            var delayMs = parseInt(body.delayMs, 10) || 500;
            var maxEmpties = Math.min(parseInt(body.maxEmpties, 10) || 50, 200);
            var dryRun = !!body.dry_run;
            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;

            // Load all songs without telegram_message_id for matching
            var songsRows = await DB.prepare("SELECT id,title,lyrics,tg_video_url,tg_file_id FROM songs WHERE visible=1").all();
            var songs = songsRows.results || [];

            // Build title lookup: normalize title -> song id
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
                  if (fwd.video) { fileId = fwd.video.file_id; msgType = "video"; }
                  else if (fwd.audio) { fileId = fwd.audio.file_id; msgType = "audio"; }
                  else if (fwd.voice) { fileId = fwd.voice.file_id; msgType = "voice"; }

                  // Try to match to a song by title
                  var firstLine = (text.split("\n")[0] || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
                  var match = titleToSong[firstLine] || null;

                  // Also try fuzzy: check if song title is contained in first line or vice versa
                  if (!match && firstLine.length > 5) {
                    for (var k in titleToSong) {
                      if (k.length > 5 && (firstLine.indexOf(k) !== -1 || k.indexOf(firstLine) !== -1)) {
                        match = titleToSong[k];
                        break;
                      }
                    }
                  }

                  // Also try matching by lyrics content
                  if (!match && fileId && text.length > 20) {
                    var normText = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
                    for (var si2 = 0; si2 < songs.length; si2++) {
                      if (songs[si2].tg_file_id) continue; // skip already repaired
                      var lyrics = (songs[si2].lyrics || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
                      if (lyrics.length > 20 && normText.length > 20) {
                        // Check if first 100 chars of lyrics match first 100 chars of caption
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

                  // Delete forwarded message
                  if (!dryRun) {
                    try { await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwd.message_id }) }); } catch (e) { }
                  }
                } else {
                  consecutiveEmpty++;
                  if (consecutiveEmpty >= maxEmpties) break;
                }
              } catch (e) {
                consecutiveEmpty++;
                if (consecutiveEmpty >= maxEmpties) break;
              }
              if (total % 50 === 0) slog("info", "scan_repair_progress", { scanned: total, matched: totalMatched });
              await new Promise(function (r) { return setTimeout(r, delayMs); });
            }

            var stillMissing = await DB.prepare("SELECT COUNT(*) as c FROM songs WHERE tg_file_id IS NULL AND visible=1").first();
            return secureJSON({ ok: true, data: {
              scanned: total, channelPostsFound: found.length, matched: matched.length,
              stillMissing: (stillMissing && stillMissing.c) || 0, dryRun: dryRun,
              matches: matched.slice(0, 30)
            }});
          } catch (e) { slog("error", "scan_repair_error", { error: e.message }); return err("Scan repair error"); }
        }

        // Debug: preview channel post captions for matching fix
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
                posts.push({ id: id, type: mediaType, caption: caption.substring(0, 200), fileId: fileId ? fileId.substring(0, 40) + "..." : null });
                try { await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwd.message_id }) }); } catch (e) { }
              } else { posts.push({ id: id, error: r.description }); }
            } catch (e) { posts.push({ id: id, error: e.message }); }
            await new Promise(function (r) { setTimeout(r, 400); });
          }
          return secureJSON({ ok: true, data: posts });
        }

        // Single song repair: forward a specific t.me message, extract file_id, save to song
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
            var parsed = mPub ? { channel: "@" + mPub[1], msgId: parseInt(mPub[2], 10) } : (mPriv ? { channel: "-100" + mPriv[1], msgId: parseInt(mPriv[2], 10) } : null);
            if (!parsed) return err("Invalid t.me link", 400);

            var tgBase = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN;
            var fwd = await (await fetch(tgBase + "/forwardMessage", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: target, from_chat_id: parsed.channel, message_id: parsed.msgId })
            })).json();

            if (!fwd.ok) return err("forwardMessage failed: " + (fwd.description || "unknown"), 400);

            var fwdMsg = fwd.result;
            var fileId = null, mediaType = null, caption = fwdMsg.caption || fwdMsg.text || "";
            if (fwdMsg.video) { fileId = fwdMsg.video.file_id; mediaType = "video"; }
            else if (fwdMsg.audio) { fileId = fwdMsg.audio.file_id; mediaType = "audio"; }
            else if (fwdMsg.voice) { fileId = fwdMsg.voice.file_id; mediaType = "audio"; }
            else if (fwdMsg.document) { fileId = fwdMsg.document.file_id; mediaType = "document"; }

            // Delete forwarded message
            try { await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwdMsg.message_id }) }); } catch (e) { }

            if (!fileId) return err("No media in message (type: " + (fwdMsg.video ? "video" : fwdMsg.audio ? "audio" : fwdMsg.voice ? "voice" : fwdMsg.document ? "document" : "text/other") + ")", 400);

            // Get fresh URL
            var freshUrl = null;
            try { var fi = await botAPI.getFile(fileId); freshUrl = botAPI.getFileUrl(fi.file_path); } catch (e) { return err("getFile failed: " + e.message, 400); }

            // Save to song
            var updates = ["tg_file_id=?"];
            var vals = [fileId];
            if (mediaType === "video") { updates.push("tg_video_url=?"); vals.push(freshUrl); }
            if (mediaType === "audio") { updates.push("suno_audio_url=?"); vals.push(freshUrl); }
            updates.push("telegram_message_id=?"); vals.push(parsed.msgId);
            vals.push(songId);
            await DB.prepare("UPDATE songs SET " + updates.join(",") + ",updated_at=datetime('now') WHERE id=?").bind(...vals).run();

            slog("info", "single_repair", { songId: songId, mediaType: mediaType, channelId: parsed.msgId });
            return secureJSON({ ok: true, data: { song_id: songId, file_id: fileId, fresh_url: freshUrl, media_type: mediaType, channel_msg_id: parsed.msgId, caption: caption.substring(0, 200) }});
          } catch (e) { slog("error", "single_repair_error", { error: e.message }); return err("Single repair error"); }
        }

        // Repair tg_file_id for songs that lost it (all songs have NULL tg_file_id)
        if (method === "POST" && path === "/api/admin/repair-file-ids") {
          if (!await isAuth(request, DB)) return err("Unauthorized", 401);
          try {
            var body = await safeJSON(request);
            var limit = Math.min(parseInt(body && body.limit || "20", 10), 50);
            var channel = (body && body.channel) || "@shemaxpoetry";
            var target = (body && body.target) || "@ShemaxPoetryFreeChat";
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
                  // Delete forwarded message to keep chat clean
                  try { await fetch(tgBase + "/deleteMessage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: target, message_id: fwd.message_id }) }); } catch (e) { }
                } else {
                  errors.push({ songId: song.id, error: r.description || "forward_failed" });
                }
              } catch (e) { errors.push({ songId: song.id, error: e.message }); }
              await new Promise(function (r) { return setTimeout(r, delayMs); });
            }
            var totalRemaining = await DB.prepare("SELECT COUNT(*) as c FROM songs WHERE tg_file_id IS NULL AND telegram_message_id IS NOT NULL AND visible=1 AND tg_video_url IS NOT NULL").first();
            return secureJSON({ ok: true, data: { repaired: repaired, errors: errors.length, remaining: (totalRemaining && totalRemaining.c) || 0, errorDetails: errors.slice(0, 10) } });
          } catch (e) { slog("error", "repair_error", { error: e.message }); return err("Repair error"); }
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
              var song = rows.results[i]; searched++;
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
                    } catch (e) { }
                  }
                }
              }
            }
            return secureJSON({ ok: true, data: { searched: searched, found: found } });
          } catch (e) { return err("Search Suno error"); }
        }

        // Metadata reviews
        if (method === "GET" && path === "/api/admin/reviews") { return secureJSON({ ok: true, data: await d.getPendingReviews() }); }
        if (method === "POST" && path === "/api/admin/reviews") {
          var body = await safeJSON(request);
          if (!body || !body.id || !body.status) return err("id and status required", 400);
          await d.resolveReview(parseInt(body.id, 10), body.status);
          slog("info", "review_resolved", { reviewId: body.id, status: body.status, requestId: requestId });
          return secureJSON({ ok: true });
        }

        // External link types
        if (method === "GET" && path === "/api/admin/link-types") { return secureJSON({ ok: true, data: await d.getLinkTypes() }); }
        if (method === "POST" && path === "/api/admin/link-types") {
          var body = await safeJSON(request);
          if (!body || !body.name) return err("name required", 400);
          if (typeof body.name !== "string" || body.name.length > 100) return err("Invalid name", 400);
          var result = await d.upsertLinkType({ name: body.name, icon: body.icon, sort_order: body.sort_order });
          return secureJSON({ ok: true, data: result }, 201);
        }
        m = path.match(/^\/api\/admin\/link-types\/(\d+)$/);
        if (m && method === "DELETE") { await d.deleteLinkType(parseInt(m[1], 10)); return secureJSON({ ok: true }); }

        // Song external links
        if (method === "GET" && path === "/api/admin/song-links") {
          var songId = safeInt(url.searchParams.get("song_id"), 0);
          if (!songId) return err("song_id required", 400);
          return secureJSON({ ok: true, data: await d.getSongExternalLinks(songId) });
        }
        if (method === "POST" && path === "/api/admin/song-links") {
          var body = await safeJSON(request);
          if (!body || !body.song_id || !body.link_type_id || !body.url) return err("song_id, link_type_id and url required", 400);
          if (typeof body.url !== "string" || body.url.length > 2000) return err("Invalid url", 400);
          var result = await d.upsertSongLink({
            song_id: parseInt(body.song_id, 10),
            link_type_id: parseInt(body.link_type_id, 10),
            url: body.url,
            description: body.description || null,
          });
          return secureJSON({ ok: true, data: result }, 201);
        }
        m = path.match(/^\/api\/admin\/song-links\/(\d+)$/);
        if (m && method === "DELETE") { await d.deleteSongLink(parseInt(m[1], 10)); return secureJSON({ ok: true }); }

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
            for (var i = 0; i < pubs.length; i++) { totalComments += pubs[i].comments.length; }
            return secureJSON({
              ok: true, data: {
                stats: stats,
                songs: { total: songCount, active: activeSongCount },
                publications: { count: pubs.length, withVideo: withVideo, withAudio: withAudio, withMedia: withFile, withSuno: withSuno, withCover: withCover, comments: totalComments },
              }
            });
          } catch (e) { slog("error", "verify_db_error", { error: e.message, requestId: requestId }); return err("Verify error"); }
        }

        return err("Not found", 404);
      }

      return err("Not found", 404);
    }

    // Privacy policy
    if (path === "/privacy") {
      return htmlResponse(PRIVACY_HTML);
    }

    // Static files from KV
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
      var origins = url.origin + " https://poetry.shemaxpoetry.workers.dev https://poetry.shemax.workers.dev https://shemaxpoetry.website.yandexcloud.net https://api.telegram.org https://cdn1.suno.ai https://cdn2.suno.ai https://raw.githubusercontent.com";
      var csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'" +
        (isAdmin ? " https://challenges.cloudflare.com" : "") +
        "; img-src 'self' " + origins + " data:;" +
        " media-src 'self' " + origins + ";" +
        " connect-src 'self' " + origins +
        (isAdmin ? " https://challenges.cloudflare.com" : "") +
        "; font-src 'self';" +
        (isAdmin ? " frame-src https://challenges.cloudflare.com;" : "");
      if (!isHtml) csp = "";
      var resp = new Response(value, { headers: { "Content-Type": ct, "Cache-Control": "no-cache, must-revalidate" } });
      if (csp) resp.headers.set("Content-Security-Policy", csp);
      return addSecurityHeaders(resp);
    } catch (e) {
      slog("error", "static_error", { error: e.message, path: path });
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
        } catch (e) { }
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
          } catch (e) { }
        }
      }
    } catch (e) { console.log(JSON.stringify({ service: "poetry", level: "error", msg: "scheduled_error", ts: new Date().toISOString(), data: { error: e.message } })); }
  }
};