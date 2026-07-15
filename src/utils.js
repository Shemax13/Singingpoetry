export async function safeJSON(req) {
  try { return await req.json(); } catch (e) { return null; }
}

export var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400"
};

export var corsRestricted = {
  "Access-Control-Allow-Origin": "https://poetry.shemax.workers.dev",
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
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

export function json(d, s) {
  return new Response(JSON.stringify(d), { status: s || 200, headers: Object.assign({}, cors, { "Content-Type": "application/json" }, secureHeaders) });
}

export function jsonRestricted(d, s) {
  return new Response(JSON.stringify(d), { status: s || 200, headers: Object.assign({}, corsRestricted, { "Content-Type": "application/json" }, secureHeaders) });
}

export function err(s, c) {
  return json({ ok: false, error: s }, c || 500);
}

export function htmlResponse(body, s) {
  return new Response(body, { status: s || 200, headers: Object.assign({ "Content-Type": "text/html; charset=utf-8" }, secureHeaders) });
}

export function validateText(val, maxLen, label) {
  if (val === null || val === undefined) return null;
  if (typeof val !== "string") return label + " must be a string";
  if (val.length > maxLen) return label + " exceeds " + maxLen + " characters";
  return null;
}

export function validateInt(val, min, max, label) {
  if (val === null || val === undefined) return null;
  var n = parseInt(val, 10);
  if (isNaN(n)) return label + " must be a number";
  if (n < min || n > max) return label + " must be between " + min + " and " + max;
  return null;
}

export var rateLimitStore = {};
export var RATE_LIMIT_WINDOW = 60000;

export function rateLimit(key, maxRequests, windowMs) {
  windowMs = windowMs || RATE_LIMIT_WINDOW;
  var now = Date.now();
  if (!rateLimitStore[key]) rateLimitStore[key] = [];
  var entries = rateLimitStore[key];
  while (entries.length && entries[0] < now - windowMs) entries.shift();
  if (entries.length >= maxRequests) return true;
  entries.push(now);
  return false;
}

export function rateLimitResponse(key, maxRequests, windowMs) {
  if (rateLimit(key, maxRequests, windowMs)) {
    return err("Too many requests. Try again later.", 429);
  }
  return null;
}

export function secureJSON(d, s) {
  return new Response(JSON.stringify(d), { status: s || 200, headers: Object.assign({}, corsRestricted, { "Content-Type": "application/json" }, secureHeaders) });
}

export function genToken() {
  var b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
}

export function safeInt(v, d) {
  var n = parseInt(v, 10);
  return isNaN(n) ? d : n;
}

export async function isAuth(req, DB) {
  var h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return false;
  return !!(await DB.prepare("SELECT id FROM admin_sessions WHERE id=? AND expires_at>datetime('now')").bind(h.slice(7)).first());
}

export function firstLine(caption) {
  if (!caption) return "Untitled";
  var s = caption.split("\n")[0];
  return s ? s.trim() : "Untitled";
}

export function sunoExtractUrls(text) {
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

var sunoFetchCache = new Map();
var SUNO_CACHE_TTL = 3600000;

export async function sunoFetch(url) {
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
    trackUrl: url,
  };
  sunoFetchCache.set(url, { ts: Date.now(), data: result });
  return result;
}

export async function processSunoUrl(url) {
  try {
    var info = await sunoFetch(url);
    if (!info.audioUrl) return null;
    return info;
  } catch (e) { return null; }
}

export function parseMsgFull(update) {
  if (!update) return null;
  var m = update.message || update.channel_post || update;
  if (!m || !m.message_id) return null;
  var chat = m.chat;
  var chatId = chat.username ? "@" + chat.username : "" + chat.id;
  var chatType = chat.type;
  var text = m.text || m.caption || "";
  var published = new Date((m.date || 0) * 1000).toISOString();
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
    published_at: published,
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

export var mimeTypes = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".eot": "application/vnd.ms-fontobject",
};