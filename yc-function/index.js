const { Driver, MetadataAuthService, AUTO_TX } = require('ydb-sdk');
const crypto = require('crypto');

const YDB_ENDPOINT = process.env.YDB_ENDPOINT || 'grpcs://ydb.serverless.yandexcloud.net:2135';
const YDB_DATABASE = process.env.YDB_DATABASE || '/ru-central1/b1g25si1urnkfqhh7vlj/etnoghq53eii07srv7np';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TG_API_BASE = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN;

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '86400' };
const secureHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

const rateLimitStore = {};

function rateLimit(key, maxRequests, windowMs = 60000) {
  const now = Date.now();
  if (!rateLimitStore[key]) rateLimitStore[key] = [];
  const entries = rateLimitStore[key];
  while (entries.length && entries[0] < now - windowMs) entries.shift();
  if (entries.length >= maxRequests) return true;
  entries.push(now);
  return false;
}

let driverInstance = null;

async function getDriver() {
  if (driverInstance) return driverInstance;
  const authService = new MetadataAuthService();
  const driver = new Driver({ endpoint: YDB_ENDPOINT, database: YDB_DATABASE, authService });
  if (!await driver.ready(10000)) throw new Error('YDB driver not ready');
  driverInstance = driver;
  return driver;
}

function ts() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

async function ydbSelect(sql) {
  const driver = await getDriver();
  return await driver.tableClient.withSession(async (session) => {
    const result = await session.executeQuery(sql);
    const rs = result.resultSets[0];
    if (!rs || !rs.rows) return [];
    const columns = rs.columns || [];
    return rs.rows.map(row => {
      const obj = {};
      columns.forEach((col, idx) => {
        const val = row.items[idx];
        if (!val) { obj[col.name] = null; return; }
        if (val.uint64Value !== undefined && val.uint64Value !== null) obj[col.name] = Number(val.uint64Value);
        else if (val.int64Value !== undefined && val.int64Value !== null) obj[col.name] = Number(val.int64Value);
        else if (val.textValue !== undefined && val.textValue !== null) obj[col.name] = val.textValue;
        else if (val.boolValue !== undefined && val.boolValue !== null) obj[col.name] = val.boolValue;
        else if (val.bytesValue !== undefined && val.bytesValue !== null) obj[col.name] = val.bytesValue;
        else if (val.doubleValue !== undefined && val.doubleValue !== null) obj[col.name] = val.doubleValue;
        else if (val.floatValue !== undefined && val.floatValue !== null) obj[col.name] = val.floatValue;
        else obj[col.name] = null;
      });
      return obj;
    });
  });
}

async function ydbExec(sql) {
  const driver = await getDriver();
  return await driver.tableClient.withSession(async (session) => {
    return await session.executeQuery(sql);
  });
}

function json(data, status = 200) {
  return { statusCode: status, headers: { ...cors, 'Content-Type': 'application/json', ...secureHeaders }, body: JSON.stringify(data) };
}

function err(msg, status = 500) {
  return json({ ok: false, error: msg }, status);
}

function redirect(location) {
  return { statusCode: 302, headers: { ...cors, Location: location }, body: '' };
}



async function sunoFetch(url) {
  const resp = await fetch('https://opensuno.vercel.app/track?url=' + encodeURIComponent(url));
  if (resp.status === 429) throw new Error('Rate limited');
  const data = await resp.json();
  if (data.status !== 'ok' || !data.data) throw new Error(data.message || 'opensuno failed');
  return {
    title: data.data.title || 'Untitled',
    audioUrl: data.data.mp3_url || null,
    coverUrl: data.data.cover_url || null,
    duration: data.data.duration || null,
    trackUrl: url,
  };
}

function sunoExtractUrls(text) {
  if (!text) return [];
  const urls = [];
  const re = /(?:https?:\/\/)?(?:www\.)?suno\.com\/(?:s|song)\/([a-zA-Z0-9]+(?:-[a-f0-9-]+)?)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = m[1];
    const url = id.includes('-') ? 'https://suno.com/song/' + id : 'https://suno.com/s/' + id;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function firstLine(text) {
  if (!text) return 'Untitled';
  const s = text.split('\n')[0];
  return s ? s.trim() : 'Untitled';
}

function parseMsgFull(update) {
  if (!update) return null;
  const m = update.message || update.channel_post || update;
  if (!m || !m.message_id) return null;
  const chat = m.chat;
  const chatId = chat.username ? '@' + chat.username : '' + chat.id;
  const published = new Date((m.date || 0) * 1000).toISOString();
  const result = {
    tg_msg_id: m.message_id, chat_id: chatId, chat_type: chat.type || 'group',
    msg_type: 'text', text_content: m.text || m.caption || null,
    file_id: null, file_unique_id: null, file_url: null, mime_type: null,
    file_size: null, duration: null, file_name: null,
    forward_from_chat_id: null, forward_from_msg_id: null,
    reply_to_msg_id: null, reply_to_chat_id: null, published_at: published,
  };
  if (m.forward_from_chat && m.forward_from_message_id) {
    result.forward_from_chat_id = m.forward_from_chat.username ? '@' + m.forward_from_chat.username : '' + m.forward_from_chat.id;
    result.forward_from_msg_id = m.forward_from_message_id;
  }
  if (m.reply_to_message) {
    result.reply_to_msg_id = m.reply_to_message.message_id;
    if (m.reply_to_message.chat) result.reply_to_chat_id = m.reply_to_message.chat.username ? '@' + m.reply_to_message.chat.username : '' + m.reply_to_message.chat.id;
  }
  const media = m.video || m.audio || m.voice || m.photo || m.document;
  if (m.video) { result.msg_type = 'video'; result.file_id = m.video.file_id; result.file_unique_id = m.video.file_unique_id; result.mime_type = m.video.mime_type; result.file_size = m.video.file_size; result.duration = m.video.duration; }
  else if (m.audio) { result.msg_type = 'audio'; result.file_id = m.audio.file_id; result.file_unique_id = m.audio.file_unique_id; result.mime_type = m.audio.mime_type || 'audio/mpeg'; result.file_size = m.audio.file_size; result.duration = m.audio.duration; result.file_name = m.audio.file_name; }
  else if (m.voice) { result.msg_type = 'voice'; result.file_id = m.voice.file_id; result.file_unique_id = m.voice.file_unique_id; result.mime_type = 'audio/ogg'; result.file_size = m.voice.file_size; result.duration = m.voice.duration; }
  else if (m.photo && m.photo.length) { result.msg_type = 'photo'; const bp = m.photo[m.photo.length - 1]; result.file_id = bp.file_id; result.file_unique_id = bp.file_unique_id; }
  else if (m.document) { result.msg_type = 'document'; result.file_id = m.document.file_id; result.file_unique_id = m.document.file_unique_id; result.mime_type = m.document.mime_type; result.file_size = m.document.file_size; }
  return result;
}

const GITHUB_RAW = 'https://raw.githubusercontent.com/Shemax13/Singingpoetry/master/audio/';
const PODCAST_URLS = {};
PODCAST_URLS[394] = GITHUB_RAW + 'The thirteenth wave podcast.m4a';
PODCAST_URLS[390] = GITHUB_RAW + 'The thirteenth wave podcast.m4a';
PODCAST_URLS[228] = GITHUB_RAW + 'Грейпфрут.mp3';
PODCAST_URLS[439] = GITHUB_RAW + 'Прогресс_против_безграничной_глупости.m4a';
PODCAST_URLS[448] = GITHUB_RAW + 'Ртуть_от_градусника_до_смертельной_угрозы.m4a';
PODCAST_URLS[440] = GITHUB_RAW + 'Стихотворение_Шейнина_Бесснежная_зима_и_тревога.m4a';
PODCAST_URLS[226] = GITHUB_RAW + 'Как_мир_встречает_Новый_год_от_Испании_до_Японии.m4a';
PODCAST_URLS[231] = GITHUB_RAW + 'Максим_Шейнин_Она_художник_Психологическая_драма_стиха.m4a';

async function tgGetFile(fileId) {
  const r = await (await fetch(TG_API_BASE + '/getFile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId }) })).json();
  if (!r.ok) throw new Error('TG getFile failed');
  return r.result;
}
function tgFileUrl(path) { return 'https://api.telegram.org/file/bot' + TELEGRAM_BOT_TOKEN + '/' + path; }

async function isAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const rows = await ydbSelect(`SELECT id FROM admin_sessions WHERE id = ${esc(authHeader.slice(7))} AND expires_at > '${ts()}'`);
  return rows.length > 0;
}

exports.handler = async (rawEvent, context) => {
  const ev = (rawEvent && rawEvent.payload) ? rawEvent.payload : (rawEvent || {});
  const method = ev.httpMethod || '';
  let path = ev.path || '';
  const headers = ev.headers || {};
  const query = ev.queryStringParameters || {};
  const body = ev.body ? (() => { try { return JSON.parse(ev.body); } catch { return null; } })() : null;

  if (ev.pathParams && ev.pathParams.proxy) {
    path = '/api/' + ev.pathParams.proxy;
  } else if (ev.url) {
    const u = ev.url.split('?')[0];
    if (u.startsWith('/api/')) path = u;
  }

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: { ...cors }, body: '' };
  }

  if (!path.startsWith('/api/')) return err('Not found', 404);

  const rlKey = headers['x-real-ip'] || headers['x-forwarded-for'] || 'unknown';
  const isAdminPath = path.startsWith('/api/admin/');
  const rlScope = path === '/api/admin/login' ? 'login' : (isAdminPath ? 'admin' : 'public');
  const rlMax = path === '/api/admin/login' ? 5 : (isAdminPath ? 20 : 100);
  if (rateLimit('rl:' + rlKey + ':' + rlScope, rlMax)) return err('Too many requests', 429);

  try {
    if (method === 'GET' && path === '/api/songs') {
      const limit = Math.min(parseInt(query.limit) || 50, 200);
      const offset = Math.max(parseInt(query.offset) || 0, 0);
      const songs = await ydbSelect(
        `SELECT id, telegram_message_id, title, lyrics, tg_video_url, tg_file_id, suno_audio_url, suno_cover_url, suno_track_url, cover_url, published_at, order_index, language FROM songs WHERE visible = true ORDER BY order_index ASC, id DESC LIMIT ${limit} OFFSET ${offset}`
      );
      for (const s of songs) {
        s.media_url = s.tg_video_url || s.suno_audio_url || null;
        const extra = await ydbSelect(`SELECT COUNT(*) as cnt FROM extra_audio WHERE song_id = ${s.id} AND file_type = 'podcast' AND visible = true`);
        s.podcast_count = (extra[0]?.cnt || 0) + (PODCAST_URLS[s.id] ? 1 : 0);
        const url = await ydbSelect(`SELECT file_url FROM extra_audio WHERE song_id = ${s.id} AND file_type = 'podcast' AND visible = true ORDER BY id ASC LIMIT 1`);
        s.podcast_audio_url = url[0]?.file_url || PODCAST_URLS[s.id] || null;
      }
      const countRows = await ydbSelect('SELECT COUNT(*) as cnt FROM songs WHERE visible = true');
      return json({ ok: true, data: songs, count: countRows[0]?.cnt || 0 });
    }

    const m1 = path.match(/^\/api\/songs\/(\d+)$/);
    if (m1 && method === 'GET') {
      const song = (await ydbSelect(`SELECT * FROM songs WHERE id = ${parseInt(m1[1])} AND visible = true`))[0];
      if (!song) return err('Not found', 404);
      song.media_url = song.tg_video_url || song.suno_audio_url || null;
      const url = await ydbSelect(`SELECT file_url FROM extra_audio WHERE song_id = ${song.id} AND file_type = 'podcast' AND visible = true ORDER BY id ASC LIMIT 1`);
      song.podcast_audio_url = url[0]?.file_url || PODCAST_URLS[song.id] || null;
      return json({ ok: true, data: song });
    }

    const mNext = path.match(/^\/api\/songs\/(\d+)\/next$/);
    if (mNext && method === 'GET') {
      const current = (await ydbSelect(`SELECT * FROM songs WHERE id = ${parseInt(mNext[1])}`))[0];
      if (!current) return err('Not found', 404);
      let next = (await ydbSelect(`SELECT * FROM songs WHERE visible = true AND order_index > ${current.order_index || 0} ORDER BY order_index ASC LIMIT 1`))[0];
      if (!next) next = (await ydbSelect('SELECT * FROM songs WHERE visible = true ORDER BY order_index ASC LIMIT 1'))[0];
      return next ? json({ ok: true, data: next }) : err('No next', 404);
    }

    const mPod = path.match(/^\/api\/song\/(\d+)\/podcasts$/);
    if (mPod && method === 'GET') {
      const songId = parseInt(mPod[1]);
      let ps = await ydbSelect(`SELECT * FROM extra_audio WHERE song_id = ${songId} AND file_type = 'podcast' AND visible = true ORDER BY id ASC`);
      if (!ps.length && PODCAST_URLS[songId]) {
        ps = [{ id: 0, song_id: songId, title: 'Подкаст', file_url: PODCAST_URLS[songId], file_type: 'podcast', visible: true }];
      }
      return json({ ok: true, data: ps });
    }

    const mLinks = path.match(/^\/api\/song\/(\d+)\/links$/);
    if (mLinks && method === 'GET') {
      const songId = parseInt(mLinks[1]);
      const links = await ydbSelect(`SELECT * FROM song_external_links WHERE song_id = ${songId} ORDER BY id ASC`);
      const types = await ydbSelect('SELECT * FROM external_link_types ORDER BY id ASC');
      const typeMap = {};
      for (const t of types) typeMap[t.id] = t;
      for (const l of links) {
        if (l.link_type_id && typeMap[l.link_type_id]) {
          l.link_type_name = typeMap[l.link_type_id].name;
          l.link_type_icon = typeMap[l.link_type_id].icon;
        }
      }
      return json({ ok: true, data: links });
    }

    if (method === 'POST' && path === '/api/webhook') {
      const raw = event.body || '';
      if (!raw || raw.length > 100000) return json({ ok: true });
      const update = (() => { try { return JSON.parse(raw); } catch { return null; } })();
      if (!update) return json({ ok: true });
      const p = parseMsgFull(update);
      if (!p || !p.tg_msg_id) return json({ ok: true });
      if (p.text_content) p.text_content = p.text_content.substring(0, 5000);

      const existing = await ydbSelect(`SELECT id FROM messages WHERE chat_id = ${esc(p.chat_id)} AND tg_msg_id = ${p.tg_msg_id}`);
      if (existing.length) return json({ ok: true });

      if (p.chat_type === 'channel' || p.chat_type === 'group') {
        if (p.file_id && p.forward_from_chat_id && p.forward_from_msg_id) {
          try { const fi = await tgGetFile(p.file_id); p.file_url = tgFileUrl(fi.file_path); } catch {}
        }
        const id = Date.now();
        await ydbExec(`UPSERT INTO messages (id, tg_msg_id, chat_id, chat_type, msg_type, text_content, file_id, file_url, published_at, created_at, forward_from_chat_id, forward_from_msg_id) VALUES (${id}, ${p.tg_msg_id}, ${esc(p.chat_id)}, ${esc(p.chat_type)}, ${esc(p.msg_type)}, ${esc(p.text_content)}, ${esc(p.file_id)}, ${esc(p.file_url)}, ${esc(p.published_at)}, '${ts()}', ${esc(p.forward_from_chat_id)}, ${p.forward_from_msg_id})`);
      }

      const msgIdForDedup = p.forward_from_msg_id || p.tg_msg_id;
      const isSong = (p.msg_type === 'video' || p.msg_type === 'audio' || (p.msg_type === 'document' && p.mime_type && p.mime_type.startsWith('audio/'))) && p.file_id;

      if (isSong) {
        const existingSong = await ydbSelect(`SELECT id FROM songs WHERE telegram_message_id = ${msgIdForDedup}`);
        if (existingSong.length) return json({ ok: true });
        try {
          const fi = await tgGetFile(p.file_id);
          const songObj = { title: firstLine(p.text_content), lyrics: p.text_content, telegram_message_id: msgIdForDedup, published_at: p.published_at };
          if (p.msg_type === 'video') {
            songObj.tg_video_url = tgFileUrl(fi.file_path);
            songObj.tg_file_id = p.file_id;
          } else {
            songObj.suno_audio_url = tgFileUrl(fi.file_path);
          }
          const maxId = await ydbSelect('SELECT MAX(id) as max_id FROM songs');
          songObj.id = (maxId[0]?.max_id || 0) + 1;
          await ydbExec(`UPSERT INTO songs (id, title, lyrics, telegram_message_id, tg_video_url, tg_file_id, suno_audio_url, published_at, visible, language, order_index, created_at, updated_at) VALUES (${songObj.id}, ${esc(songObj.title)}, ${esc(songObj.lyrics)}, ${songObj.telegram_message_id}, ${esc(songObj.tg_video_url)}, ${esc(songObj.tg_file_id)}, ${esc(songObj.suno_audio_url)}, ${esc(songObj.published_at)}, true, 'ru', 0, '${ts()}', '${ts()}')`);
        } catch {}
      }

      const sunoUrls = sunoExtractUrls(p.text_content);
      if (sunoUrls.length) {
        let targetSongId = null;
        if (isSong) {
          const s = await ydbSelect(`SELECT id FROM songs WHERE telegram_message_id = ${msgIdForDedup}`);
          if (s.length) targetSongId = s[0].id;
        }
        if (!targetSongId && p.forward_from_msg_id) {
          const s = await ydbSelect(`SELECT id FROM songs WHERE telegram_message_id = ${p.forward_from_msg_id}`);
          if (s.length) targetSongId = s[0].id;
        }
        for (const su of sunoUrls) {
          try {
            const sinfo = await sunoFetch(su);
            if (sinfo && sinfo.audioUrl) {
              if (targetSongId) {
                const cur = (await ydbSelect(`SELECT * FROM songs WHERE id = ${targetSongId}`))[0];
                await ydbExec(`UPSERT INTO songs (id, title, lyrics, telegram_message_id, suno_audio_url, suno_cover_url, suno_track_url, published_at, visible, language, order_index, created_at, updated_at) VALUES (${targetSongId}, ${esc(cur?.title || sinfo.title)}, ${esc(cur?.lyrics || p.text_content)}, ${cur?.telegram_message_id || msgIdForDedup}, ${esc(sinfo.audioUrl)}, ${esc(sinfo.coverUrl)}, ${esc(sinfo.trackUrl)}, ${esc(p.published_at)}, true, 'ru', ${cur?.order_index || 0}, '${ts()}', '${ts()}')`);
              } else {
                const maxId = await ydbSelect('SELECT MAX(id) as max_id FROM songs');
                const newId = (maxId[0]?.max_id || 0) + 1;
                await ydbExec(`UPSERT INTO songs (id, title, lyrics, telegram_message_id, suno_audio_url, suno_cover_url, suno_track_url, published_at, visible, language, order_index, created_at, updated_at) VALUES (${newId}, ${esc(sinfo.title)}, ${esc(p.text_content)}, ${msgIdForDedup}, ${esc(sinfo.audioUrl)}, ${esc(sinfo.coverUrl)}, ${esc(sinfo.trackUrl)}, ${esc(p.published_at)}, true, 'ru', 0, '${ts()}', '${ts()}')`);
                targetSongId = newId;
              }
            }
          } catch {}
        }
      }
      return json({ ok: true });
    }

    const mMedia = path.match(/^\/api\/media\/(\d+)$/);
    if (mMedia && method === 'GET') {
      const song = (await ydbSelect(`SELECT tg_video_url, suno_audio_url, tg_file_id FROM songs WHERE id = ${parseInt(mMedia[1])} AND visible = true`))[0];
      if (!song) return err('Not found', 404);
      let url = song.tg_video_url || song.suno_audio_url;
      if (!url && song.tg_file_id && TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'dummy') {
        try { const fi = await tgGetFile(song.tg_file_id); url = tgFileUrl(fi.file_path); } catch {}
      }
      if (!url) return err('No media', 404);
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const contentType = resp.headers.get('content-type') || 'application/octet-stream';
          const total = parseInt(resp.headers.get('content-length') || '0');
          if (total > 0 && total < 50 * 1024 * 1024) {
            const buf = await resp.arrayBuffer();
            const base64 = Buffer.from(buf).toString('base64');
            return {
              statusCode: 200,
              headers: { ...cors, 'Content-Type': contentType, 'Content-Length': String(buf.byteLength), 'Cache-Control': 'public, max-age=86400', ...secureHeaders },
              body: base64,
              isBase64Encoded: true,
            };
          }
        }
      } catch (e) {
        console.error('Media proxy error:', e && e.message);
      }
      return redirect(url);
    }

    const mTgFile = path.match(/^\/api\/tg-file-url\/(\d+)$/);
    if (mTgFile && method === 'GET') {
      const song = (await ydbSelect(`SELECT tg_video_url, suno_audio_url FROM songs WHERE id = ${parseInt(mTgFile[1])}`))[0];
      const url = song?.tg_video_url || song?.suno_audio_url || '';
      return json({ ok: true, url });
    }

    if (method === 'POST' && path === '/api/admin/login') {
      if (!body || !body.password || typeof body.password !== 'string') return err('Password required', 400);
      if (body.password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const createdAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
        await ydbExec(`UPSERT INTO admin_sessions (id, created_at, expires_at) VALUES (${esc(token)}, '${createdAt}', ${esc(expiresAt)})`);
        return json({ ok: true, data: { token } });
      }
      return err('Invalid password', 401);
    }

    if (path.startsWith('/api/admin/')) {
      const authVal = headers['authorization'] || headers['Authorization'];
      if (!await isAuth(authVal)) return err('Unauthorized', 401);

      if (method === 'GET' && path === '/api/admin/songs') {
        const songs = await ydbSelect('SELECT * FROM songs ORDER BY order_index ASC, id DESC');
        return json({ ok: true, data: songs });
      }

      if (method === 'POST' && path === '/api/admin/songs') {
        if (!body) return err('Invalid JSON', 400);
        const maxId = await ydbSelect('SELECT MAX(id) as max_id FROM songs');
        const newId = (maxId[0]?.max_id || 0) + 1;
        await ydbExec(`UPSERT INTO songs (id, title, lyrics, visible, language, order_index, published_at, created_at, updated_at) VALUES (${newId}, ${esc(body.title)}, ${esc(body.lyrics)}, true, ${esc(body.language || 'ru')}, ${body.order_index || 0}, '${ts()}', '${ts()}', '${ts()}')`);
        return json({ ok: true, data: { id: newId } }, 201);
      }

      const mAdminSong = path.match(/^\/api\/admin\/songs\/(\d+)$/);
      if (mAdminSong && method === 'GET') {
        const song = (await ydbSelect(`SELECT * FROM songs WHERE id = ${parseInt(mAdminSong[1])}`))[0];
        return song ? json({ ok: true, data: song }) : err('Not found', 404);
      }
      if (mAdminSong && method === 'PUT') {
        if (!body) return err('Invalid JSON', 400);
        const id = parseInt(mAdminSong[1]);
        await ydbExec(`UPSERT INTO songs (id, title, lyrics, tg_video_url, suno_audio_url, visible, language, order_index, updated_at) VALUES (${id}, ${esc(body.title || '')}, ${esc(body.lyrics || '')}, ${esc(body.tg_video_url)}, ${esc(body.suno_audio_url)}, ${body.visible !== undefined ? (body.visible ? 'true' : 'false') : 'true'}, ${esc(body.language || 'ru')}, ${body.order_index || 0}, '${ts()}')`);
        return json({ ok: true });
      }
      if (mAdminSong && method === 'DELETE') {
        await ydbExec(`UPSERT INTO songs (id, visible, updated_at) VALUES (${parseInt(mAdminSong[1])}, false, '${ts()}')`);
        return json({ ok: true });
      }

      if (method === 'POST' && path === '/api/admin/sumo') {
        if (!body || !body.url) return err('url required', 400);
        const info = await sunoFetch(body.url);
        return json({ ok: true, data: info });
      }

      if (method === 'POST' && path === '/api/admin/setup-webhook') {
        const whUrl = query.url || 'https://d5d8a3k77r6d3l9i214a.avjje9e3.apigw.yandexcloud.net/api/webhook';
        const me = await (await fetch(TG_API_BASE + '/getMe')).json();
        if (!me.ok) return json({ ok: true, data: { error: 'Bot token invalid' } });
        const tgResp = await (await fetch(TG_API_BASE + '/setWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: whUrl, allowed_updates: ['message', 'channel_post'] }) })).json();
        return json({ ok: true, data: { me: me.result, webhook: tgResp } });
      }

      if (method === 'PUT' && path === '/api/admin/songs') {
        if (!body || !body.ids || !Array.isArray(body.ids)) return err('Invalid request', 400);
        for (let i = 0; i < body.ids.length; i++) {
          await ydbExec(`UPSERT INTO songs (id, order_index, updated_at) VALUES (${body.ids[i]}, ${i + 1}, '${ts()}')`);
        }
        return json({ ok: true });
      }

      const mExtraAudio = path.match(/^\/api\/admin\/songs\/(\d+)\/extra-audio$/);
      if (mExtraAudio && method === 'GET') {
        const rows = await ydbSelect(`SELECT * FROM extra_audio WHERE song_id = ${parseInt(mExtraAudio[1])} AND visible = true ORDER BY id ASC`);
        return json({ ok: true, data: rows });
      }

      if (method === 'GET' && path === '/api/admin/audio-files') {
        try {
          const rows = await ydbSelect(`SELECT m.id, m.tg_msg_id, m.chat_id, m.text_content, m.file_id, m.file_url, m.file_name, m.duration, m.published_at, m.msg_type FROM messages m LEFT JOIN songs s ON s.telegram_message_id = m.tg_msg_id AND s.chat_id = m.chat_id WHERE s.id IS NULL AND m.msg_type IN ('audio','voice','document') AND m.file_url IS NOT NULL ORDER BY m.id DESC LIMIT 200`);
          return json({ ok: true, data: rows });
        } catch (e) {
          return json({ ok: true, data: [] });
        }
      }

      if (method === 'POST' && path === '/api/admin/extra-audio') {
        if (!body || !body.song_id) return err('song_id required', 400);
        const maxId = await ydbSelect('SELECT MAX(id) as max_id FROM extra_audio');
        const newId = (maxId[0]?.max_id || 0) + 1;
        await ydbExec(`UPSERT INTO extra_audio (id, song_id, title, file_url, duration, telegram_message_id, file_type, source, visible, created_at, updated_at) VALUES (${newId}, ${body.song_id}, ${esc(body.title || 'Podcast')}, ${esc(body.file_url)}, ${body.duration !== null && body.duration !== undefined ? body.duration : 'NULL'}, ${body.telegram_message_id || 'NULL'}, 'podcast', 'telegram', true, '${ts()}', '${ts()}')`);
        return json({ ok: true, data: { id: newId } }, 201);
      }

      const mDelExtra = path.match(/^\/api\/admin\/extra-audio\/(\d+)$/);
      if (mDelExtra && method === 'DELETE') {
        await ydbExec(`UPSERT INTO extra_audio (id, visible, updated_at) VALUES (${parseInt(mDelExtra[1])}, false, '${ts()}')`);
        return json({ ok: true });
      }

      if (method === 'GET' && path === '/api/admin/publications') {
        try {
          const rows = await ydbSelect(`SELECT m.*, s.id as song_id, s.title as song_title FROM messages m LEFT JOIN songs s ON s.telegram_message_id = m.tg_msg_id ORDER BY m.id DESC LIMIT 50`);
          return json({ ok: true, data: rows });
        } catch (e) {
          return json({ ok: true, data: [] });
        }
      }

      return err('Not found', 404);
    }

    return err('Not found', 404);
  } catch (e) {
    console.error(JSON.stringify({ error: e.message, stack: e.stack?.slice(0, 500) }));
    return err('Internal error: ' + e.message);
  }
};
