export function cappedMap(maxSize) {
  var m = new Map();
  var _set = m.set.bind(m);
  m.set = function (k, v) {
    if (m.has(k)) { _set(k, v); return; }
    if (m.size >= maxSize) { var first = m.keys().next().value; m.delete(first); }
    _set(k, v);
  };
  return m;
}

export var mediaCache = cappedMap(500);
export var CACHE_TTL = 600000;

export function tg(token, kv) {
  var base = "https://api.telegram.org/bot" + token;
  return {
    async getFile(fid) {
      // 1. In-memory cache (including failures)
      var cached = mediaCache.get(fid);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        if (cached._fail) throw new Error("TG"); // Cached failure
        return cached.result;
      }
      // 2. KV cache (persists across cold starts)
      if (kv) {
        try {
          var kvRaw = await kv.get("getfile:" + fid, { type: "json" });
          if (kvRaw && Date.now() - kvRaw.ts < CACHE_TTL) {
            mediaCache.set(fid, kvRaw);
            if (kvRaw._fail) throw new Error("TG");
            return kvRaw.result;
          }
        } catch (e) { }
      }
      // 3. Fetch from Telegram
      var ac = new AbortController();
      var t = setTimeout(function () { ac.abort(); }, 15000);
      try {
        var r = await (await fetch(base + "/getFile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fid }), signal: ac.signal })).json();
        if (!r.ok) {
          // Cache failure to avoid repeated 3s timeouts for invalid file_ids
          var failEntry = { result: null, ts: Date.now(), _fail: true };
          mediaCache.set(fid, failEntry);
          if (kv) kv.put("getfile:" + fid, JSON.stringify(failEntry)).catch(function (e) { console.error("KV put failEntry failed", e); });
          throw new Error("TG");
        }
        var entry = { result: r.result, ts: Date.now() };
        mediaCache.set(fid, entry);
        if (kv) kv.put("getfile:" + fid, JSON.stringify(entry)).catch(function (e) { console.error("KV put entry failed", e); });
        return r.result;
      } finally { clearTimeout(t); }
    },
    getFileUrl(p) { return "https://api.telegram.org/file/bot" + token + "/" + p; },
  };
}
