# ShemaxPoetry — Полный план разработки

> Версия 2.0 — 28 июня 2026
> Весь проект: R2 миграция → Suno метаданные → Подкасты → Внешние ссылки → Поиск → Кросс-постинг → Аналитика

---

## Содержание

1. [Текущее состояние](#1-текущее-состояние)
2. [Этап 0: Фундамент (инфраструктура)](#2-этап-0-фундамент-инфраструктура)
3. [Этап 1: R2 Upload Queue](#3-этап-1-r2-upload-queue)
4. [Этап 2: Suno метаданные](#4-этап-2-suno-метаданные)
5. [Этап 3: Поиск и фильтрация](#5-этап-3-поиск-и-фильтрация)
6. [Этап 4: Podcast-флоу](#6-этап-4-podcast-флоу)
7. [Этап 5: Внешние ссылки](#7-этап-5-внешние-ссылки)
8. [Этап 6: Webhook + Дедупликация](#8-этап-6-webhook--дедупликация)
9. [Этап 7: Кросс-постинг](#9-этап-7-кросс-постинг)
10. [Этап 8: Аналитика](#10-этап-8-аналитика)
11. [Миграции D1 (полный список)](#11-миграции-d1-полный-список)
12. [Worker secrets](#12-worker-secrets)
13. [Обновление wrangler.jsonc](#13-обновление-wranglerjsonc)
14. [Фронтенд — полный список изменений](#14-фронтенд--полный-список-изменений)
15. [Порядок деплоя](#15-порядок-деплоя)
16. [Регистрация на платформах](#16-регистрация-на-платформах)
17. [Целевая аудитория и роли](#17-целевая-аудитория-и-роли)
18. [Требования к производительности (SLA)](#18-требования-к-производительности-sla)
19. [Требования к совместимости](#19-требования-к-совместимости)
20. [Требования к доступности (WCAG AA)](#20-требования-к-доступности-wcag-aa)
21. [Требования к SEO](#21-требования-к-seo)
22. [Правовые аспекты](#22-правовые-аспекты)
23. [Требования к тестированию и приёмке](#23-требования-к-тестированию-и-приёмке)
24. [Бюджет и лимиты (Free Tier)](#24-бюджет-и-лимиты-free-tier)
25. [CI/CD и качество кода](#25-cicd-и-качество-кода)
26. [Мониторинг и алерты](#26-мониторинг-и-алерты)
27. [План отката (Rollback)](#27-план-отката-rollback)
28. [Документация пользователя](#28-документация-пользователя)
29. [Источники и нормативные документы](#29-источники-и-нормативные-документы)

---

## 1. Текущее состояние

### 1.1 Работает сейчас

- Telegram webhook → создание песен в D1
- SPA плеер на Cloudflare Workers + D1 + KV
- GET /api/songs — список песен (visible=1, сортировка по order_index)
- GET /api/media/:id — 302 редирект на Telegram file URL
- GET /api/songs/:id/next — следующая песня
- GET /api/song/:id/podcasts — список подкастов (из audio_breakdowns)
- Admin: CRUD песен, синхронизация, Suno fetch, сканирование канала, верификация БД
- Ежедневный cron (06:00) — синхронизация Suno метаданных
- 453 песни в БД (394 visible, 297 с mp4)

### 1.2 Проблемы

- **Telegram file URLs протухают** — media переезжает, getFile нужен каждый раз
- **R2 не используется** — видео хранятся только на Telegram серверах
- **Webhook не проверяет дубликаты** — может создать дубли при повторной отправке
- **Нет поиска** — GET /api/songs без параметров search/language
- **audio_breakdowns** — старая таблица без FK, без r2_key, без file_type
- **Нет внешних ссылок** — Instagram/TikTok/VK ссылки не хранятся
- **Нет кросс-постинга** — публикация только в Telegram
- **Нет аналитики** — нет статистики по просмотрам/лайкам

### 1.5 Безопасность (реализовано)

- Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, X-Frame-Options)
- Rate limiting (100/min public, 20/min admin, 5/min login, 30/min webhook)
- Error sanitization — внутренние ошибки не показываются пользователю
- Input validation — все эндпоинты проверяют типы/длины/диапазоны
- CORS разделён: публичный API — `*`, админка — только домен worker
- API не возвращает лишние поля (internal stripping)
- SQL-инъекции предотвращены параметризованными запросами
- XSS — `escapeHtml()` во всех шаблонах
- Privacy policy (`/privacy`) с описанием сбора данных, хранения, прав GDPR/CCPA
- Cloudflare Turnstile в админке (требуется создание виджета)
- Rate limiter in-memory (сбрасывается при холодном старте)

#### Turnstile setup (dashboard)

1. Перейти: https://dash.cloudflare.com/?to=/:account/turnstile
2. Создать виджет: `shemax-admin-login`, Domain: `poetry.shemax.workers.dev`
3. Получить Site Key → вставить в `public/admin/index.html` (строка `0x4AAAAAAA...`)
4. Получить Secret Key → `wrangler secret put TURNSTILE_SECRET_KEY`

### 1.3 База данных (текущая схема)

**songs** (453 записи):
id, title, lyrics, tg_video_url, tg_file_id, suno_audio_url, suno_cover_url, suno_track_url, cover_url, visible, language, order_index, telegram_message_id, published_at, created_at, updated_at

**messages** (сотни записей):
id, tg_msg_id, chat_id, chat_type, msg_type, text_content, file_id, file_unique_id, file_url, mime_type, file_size, duration, file_name, forward_from_chat_id, forward_from_msg_id, reply_to_msg_id, reply_to_chat_id, published_at, cover_file_id, cover_url

**audio_breakdowns** (устаревшая, будет заменена):
id, song_id, title, file_url, duration, telegram_message_id, visible

**admin_sessions**: id (token), expires_at

### 1.4 Инфраструктура

- **Account ID**: `02a5ee785952a4e4b7b6da209e10c53d` (Shemax45@gmail.com) — **основной**
  - (Не путать с `a3aa2b215031e097488bb52593789c18` — Shemax@mail.ru, там пустой аккаунт)
- **Worker**: poetry (ES Module, compatibility_date 2026-07-04, nodejs_compat, script_tag: `72b3b6c81f7d44b590e56d41f6c75eed`)
- **Worker URL**: `https://poetry.shemaxpoetry.workers.dev`
- **D1**: SHEMAX_DB (id: `9f979733-d291-4e4a-af29-7cb463ca534a`) — 453 песни
- **KV**: STATIC (id: `fd50e45d91a6485b944e69056960dccd`) — фронтенд
- **R2**: shemaxpoetry — создан, пустой
- **Queue**: shemax-uploads — создана, пустая
- **API Token**: `cfoat_g2v95oseWcV1V3A5oHG32t6-KVNF1IOOy0Pd3BvOxGY.5nfuPesjyvocXqk8sBwq0nklPsNcouqQC_Ll8_Nqos8`
- **Repo**: github.com/Shemax13/Singingpoetry
- **Деплой**: Workers Builds (Dashboard) — авто при push в `master`
- **Secrets**: `TELEGRAM_BOT_TOKEN`, `ADMIN_PASSWORD`, `TURNSTILE_SECRET_KEY` — установлены. `WEBHOOK_SECRET` — не установлен (код работает без него)

---

## 2. Этап 0: Фундамент (инфраструктура)

**Статус**: 🔴 Блокировано — нужны действия пользователя в Dashboard

### 2.1 R2 bucket

```
Название: shemaxpoetry
Binding: MEDIA
Статус: создан через API
```

- 10GB бесплатно
- Для 250+ mp4 по 10-30MB ≈ 2.5-7.5GB
- При превышении: приоритет новым песням, старые — fallback на Telegram getFile

### 2.2 Queue

```
Название: shemax-uploads
Binding: UPLOAD_QUEUE
Статус: создан через API
```

- Max retries: 3
- Retry delay: 60s
- Free tier: 10k ops/day

### 2.3 wrangler.jsonc (уже обновлён)

```json
{
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "shemaxpoetry" }],
  "queues": [{ "binding": "UPLOAD_QUEUE", "queue": "shemax-uploads" }]
}
```

### 2.4 Применить миграции

```bash
npm run migrate
# Применит: 006_add_song_fields.sql, 007_create_extra_audio.sql,
#           008_create_external_links.sql, 009_create_metadata_reviews.sql
```

### 2.5 Задачи

- [x] Создать R2 bucket `shemaxpoetry`
- [x] Создать Queue `shemax-uploads`
- [x] Обновить wrangler.jsonc
- [ ] Добавить `limits.cpu_ms` при необходимости
- [ ] Выполнить `npm run migrate` (006-009)
- [ ] Передеплоить worker через `node deploy.mjs`

---

## 3. Этап 1: R2 Upload Queue

### 3.1 Queue consumer (worker.js)

```javascript
async queue(batch, env) {
  var DB = env.DB;
  var MEDIA = env.MEDIA;
  var TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

  for (var msg of batch.messages) {
    var { action, songId, tgFileId, extraAudioId } = msg.body;

    if (action === 'upload-mp4') {
      try {
        // 1. Получить file URL из Telegram
        var resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: tgFileId })
        });
        var data = await resp.json();
        if (!data.ok) { msg.retry({ delaySeconds: 60 }); continue; }

        var fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;

        // 2. Скачать из Telegram и загрузить в R2
        var fileResp = await fetch(fileUrl);
        var r2Key = `songs/${songId}.mp4`;
        await MEDIA.put(r2Key, fileResp.body);

        // 3. Обновить D1
        await DB.prepare(
          "UPDATE songs SET r2_video_url=?, updated_at=datetime('now') WHERE id=?"
        ).bind(r2Key, songId).run();

        log('info', 'r2_upload_success', { songId, r2Key });
      } catch (e) {
        log('error', 'r2_upload_failed', { songId, error: e.message });
        msg.retry({ delaySeconds: 60 });
      }
    }

    if (action === 'upload-extra') {
      try {
        var resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: tgFileId })
        });
        var data = await resp.json();
        if (!data.ok) { msg.retry({ delaySeconds: 60 }); continue; }

        var fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
        var fileResp = await fetch(fileUrl);
        var uuid = crypto.randomUUID();
        var r2Key = `extra/${uuid}.m4a`;
        await MEDIA.put(r2Key, fileResp.body);

        await DB.prepare(
          "UPDATE extra_audio SET r2_key=?, updated_at=datetime('now') WHERE id=?"
        ).bind(r2Key, extraAudioId).run();

        log('info', 'r2_upload_success', { extraAudioId, r2Key });
      } catch (e) {
        log('error', 'r2_upload_failed', { extraAudioId, error: e.message });
        msg.retry({ delaySeconds: 60 });
      }
    }

    if (action === 'crosspost') {
      await crosspostToPlatform(msg.body, env);
    }

    if (action === 'analytics') {
      await collectPlatformAnalytics(msg.body, env);
    }
  }
}
```

### 3.2 Webhook — отправка в очередь

При получении mp4/webhook:
- Сохранить tg_video_url / tg_file_id в D1 (синхронно, <10ms)
- Отправить в очередь: `{ action: 'upload-mp4', songId, tgFileId }`
- Ответ webhook — немедленно (не ждать загрузки в R2)

### 3.3 /api/media/:id — fallback chain

```
1. r2_video_url есть     → 302 redirect на R2 public URL
2. tg_file_id есть       → Telegram getFile → 302 redirect
3. tg_video_url есть     → 302 redirect (может быть протухший)
4. suno_audio_url есть   → 302 redirect (Suno CDN, постоянный)
5. ничего нет            → 404
```

### 3.4 Admin: migrate-to-r2

```
POST /api/admin/migrate-to-r2
  → Берёт пачку песен (limit=5):
     WHERE tg_file_id IS NOT NULL AND r2_migratable=1 AND r2_video_url IS NULL
  → Для каждой: отправляет в очередь { action: 'upload-mp4', songId, tgFileId }
  → Между пачками: sleep(2000ms)
  → Вызывать вручную из админки
```

### 3.5 R2 cleanup при удалении

```javascript
async function deleteSong(id, DB, MEDIA) {
  var song = await DB.prepare("SELECT r2_video_url FROM songs WHERE id=?").bind(id).first();
  if (song?.r2_video_url) {
    await MEDIA.delete(song.r2_video_url);
  }

  var extras = await DB.prepare("SELECT r2_key FROM extra_audio WHERE song_id=?").bind(id).all();
  for (var ext of extras.results) {
    if (ext.r2_key) await MEDIA.delete(ext.r2_key);
  }

  await DB.prepare("DELETE FROM extra_audio WHERE song_id=?").bind(id).run();
  await DB.prepare("UPDATE songs SET visible=0 WHERE id=?").bind(id).run();
}
```

### 3.6 Задачи

- [ ] Worker: queue consumer (upload-mp4 + upload-extra)
- [ ] Worker: отправить в очередь при webhook (для mp4 и extra_audio)
- [ ] Worker: admin endpoint `POST /api/admin/migrate-to-r2`
- [ ] Worker: обновить `/api/media/:id` (R2 → Telegram → Suno)
- [ ] Worker: обновить `deleteSong` (R2 cleanup)
- [ ] Установить 13 песен с r2_migratable=0 (invalid tg_file_id)

---

## 4. Этап 2: Suno метаданные

### 4.1 opensuno.vercel.app KV-кэш

```javascript
async function fetchSunoMetadata(trackUrl, env) {
  // 1. KV кэш (24ч TTL)
  var cacheKey = 'suno:' + trackUrl;
  var cached = await env.STATIC.get(cacheKey, { type: 'json' });
  if (cached && Date.now() - cached.ts < 86400000) return cached.data;

  // 2. opensuno прокси
  try {
    var resp = await fetch(
      'https://opensuno.vercel.app/track?url=' + encodeURIComponent(trackUrl)
    );
    if (!resp.ok) throw new Error('opensuno ' + resp.status);
    var data = await resp.json();
    await env.STATIC.put(cacheKey, JSON.stringify({ data, ts: Date.now() }));
    return data;
  } catch (e) {
    // 3. Fallback — бессрочный кэш
    var fallback = await env.STATIC.get(cacheKey + ':fallback', { type: 'json' });
    return fallback?.data || null;
  }
}
```

### 4.2 Cron — обновлённая логика

```javascript
async scheduled(event, env) {
  // 06:00 — Suno sync
  // 08:00 — Cross-post trigger
  // 06:00 — Analytics collection

  var cron = event.cron;
  if (cron === '0 6 * * *') {
    await syncSunoMetadata(env);
    await collectAnalytics(env);
  }
  if (cron === '0 8 * * *') {
    await triggerCrosspost(env);
  }
}
```

suno sync logic:
1. Выбрать песни с updated_at > 24h И без suno_audio_url
2. Для каждой: запросить opensuno (с KV кэшем)
3. Если данные отличаются:
   - Обновить БД (suno_title, suno_cover_url, lyrics)
   - pending_review = 1
   - pending_metadata = JSON diff
   - Запись в metadata_reviews
4. Если opensuno не ответил → оставить существующие данные

### 4.3 Admin review endpoints

- `GET /api/admin/metadata-reviews` — список pending review
- `POST /api/admin/metadata-reviews/:id/approve` — принять
- `POST /api/admin/metadata-reviews/:id/reject` — отклонить

UI:
- Индикатор "🟡 Pending review" для песен с pending_review=1
- Показать diff (старое → новое)
- Apply: применить, pending_review=0
- Reject: отклонить, pending_review=0

### 4.4 Задачи

- [ ] Worker: KV-кэш для opensuno (24h TTL)
- [ ] Worker: обновлённый cron с diff → pending_review
- [ ] Worker: admin endpoints для metadata_reviews
- [ ] Frontend админки: UI для pending review

---

## 5. Этап 3: Поиск и фильтрация

### 5.1 API

```
GET /api/songs?search=текст&language=ru&limit=50&offset=0
```

SQL:
```sql
SELECT s.*,
  (SELECT COUNT(*) FROM extra_audio WHERE song_id=s.id AND visible=1) as podcast_count,
  (SELECT COUNT(*) FROM song_external_links WHERE song_id=s.id) as external_link_count
FROM songs s
WHERE visible=1
  AND (? IS NULL OR (title LIKE '%' || ? || '%' OR lyrics LIKE '%' || ? || '%'))
  AND (? IS NULL OR language = ?)
ORDER BY order_index ASC, id DESC
LIMIT ? OFFSET ?
```

### 5.2 Индекс (уже в migration 006)

```sql
CREATE INDEX IF NOT EXISTS idx_songs_visible_title ON songs(visible, title);
```

### 5.3 Фронтенд

- Поле поиска в шапке плеера
- Фильтр языка (ru/en toggle)
- Результаты обновляются по мере ввода (debounce 300ms)

### 5.4 Задачи

- [ ] Worker: обновить GET /api/songs с search и language параметрами
- [ ] Frontend: поле поиска и фильтр языка

---

## 6. Этап 4: Podcast-флоу

### 6.1 Миграция 007 (уже готова)

- Создать `extra_audio` (замена `audio_breakdowns`)
- Перенести данные
- Удалить `audio_breakdowns`

### 6.2 Public API

```
GET /api/song/:id/podcasts
  → SELECT * FROM extra_audio WHERE song_id=? AND visible=1 ORDER BY id ASC
  → Добавить поле r2_url: если r2_key есть → MEDIA.publicUrl(r2_key)
```

### 6.3 Admin API

```
POST /api/admin/extra-audio         — создать: song_id, title, file_url, source='admin-url'
POST /api/admin/extra-audio/upload  — multipart upload → R2, source='admin-upload'
DELETE /api/admin/extra-audio/:id   — soft delete (visible=0)
```

### 6.4 Фронтенд — resume position

```
togglePodcast():
  → Сохраняет podcastReturnIndex + podcastReturnTime (currentTime видео/аудио)
  → Fetch /api/song/:id/podcasts
  → Если >1 — popup выбора, иначе играть сразу
  → Показывает "✕" на кнопке подкаста

По окончании подкаста:
  → audio.currentTime = podcastReturnTime; play()

Если переключил песню:
  → podcastReturnIndex сбрасывается

Если нажал ✕:
  → остановить подкаст, resume песни
```

### 6.5 Задачи

- [ ] Worker: CRUD для extra_audio (admin)
- [ ] Worker: обновить GET /api/song/:id/podcasts (с r2_url)
- [ ] Worker: queue-загрузка extra_audio в R2
- [ ] Frontend: resume position, выбор подкаста из списка

---

## 7. Этап 5: Внешние ссылки

### 7.1 Миграция 008 (уже готова)

- `external_link_types` — типы ссылок (Instagram, TikTok, VK...)
- `song_external_links` — ссылки песен
- Pre-populated: Instagram (📷), TikTok (🎵), VK (💬)

### 7.2 Public API

```
GET /api/songs/:id/links
  → SELECT elt.name, elt.icon, sel.url, sel.description
    FROM song_external_links sel
    JOIN external_link_types elt ON elt.id = sel.link_type_id
    WHERE sel.song_id=?
```

### 7.3 Admin API

```
GET/POST       /api/admin/external-link-types          — CRUD
PUT/DELETE     /api/admin/external-link-types/:id      — CRUD
GET/POST       /api/admin/songs/:id/external-links     — CRUD ссылок песни
DELETE         /api/admin/songs/:id/external-links/:id — удалить
```

### 7.4 Фронтенд

- Если у песни `external_link_count > 0` → маленькая иконка 🔗
- По клику → popup со значками ресурсов (📷 🎵 💬 и т.д.)
- Клик по значку → `window.open(url, '_blank', 'noopener')`
- Заголовок "Shemaxpoetry" → `<a href="https://t.me/shemaxpoetry">`

### 7.5 Задачи

- [ ] Worker: CRUD для external_link_types
- [ ] Worker: CRUD для song_external_links
- [ ] Worker: GET /api/songs/:id/links (public)
- [ ] Frontend: иконка 🔗 + popup
- [ ] Frontend: заголовок-ссылка на Telegram

---

## 8. Этап 6: Webhook + Дедупликация

### 8.1 Дедупликация

Уже частично реализована в storeMessage (проверка tg_msg_id + chat_id).
Нужно добавить проверку и для upsertSong:

```javascript
// В webhook handler
if (await d.getByTgMsg(p.tg_msg_id)) {
  log('warn', 'duplicate_webhook', { tg_msg_id: p.tg_msg_id });
  return new Response('OK (duplicate)');
}
```

### 8.2 Структурированные логи

```javascript
function log(level, event, data = {}) {
  console[level](JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
}
```

Ключевые события:

| Событие | Уровень | Когда |
|---------|---------|-------|
| webhook_received | info | Каждое обновление |
| duplicate_webhook | warn | Дубликат |
| r2_upload_start | info | Начало загрузки в R2 |
| r2_upload_success | info | Успешная загрузка |
| r2_upload_failed | error | Ошибка загрузки |
| suno_fetch_success | info | opensuno ответил |
| suno_fetch_failed | error | opensuno не ответил |
| metadata_updated | info | Cron обновил метаданные |
| crosspost_pending | info | Отправлено в очередь кросс-поста |
| crosspost_success | info | Кросс-пост опубликован |
| crosspost_failed | error | Кросс-пост не удался |
| analytics_collected | info | Аналитика собрана |

### 8.3 Задачи

- [ ] Worker: log() во все обработчики
- [ ] Worker: проверка дубликатов в webhook
- [ ] Настроить Workers Logs в Dashboard

---

## 9. Этап 7: Кросс-постинг

Полное описание: `analysis/crossposting-design.md`

### 9.1 Миграция 010 (новая)

Создать таблицы:
- `cross_post_config` — настройки платформ
- `cross_post_status` — статусы публикаций
- `analytics_snapshots` — снимки аналитики
- songs.rating + songs.rating_updated_at

Pre-populated cross_post_config:

| platform | enabled | icon | max_duration | max_size | cooldown |
|----------|---------|------|:------------:|:--------:|:--------:|
| telegram | 1 | ✈️ | NULL | 50MB | 0 |
| youtube | 0 | ▶️ | NULL | 256GB | 0 |
| vk | 0 | 💬 | NULL | 1024MB | 0 |
| threads | 0 | 🧵 | 300s | 100MB | 0 |
| rutube | 0 | 📺 | NULL | 20GB | 0 |

### 9.2 Queue consumer — crosspostToPlatform()

Для каждой платформы своя логика:

**YouTube**:
1. OAuth refresh → access token
2. Resumable upload: POST videos.insert (snippet + status)
3. Установить privacyStatus = unlisted/public
4. Сохранить platform_post_id, platform_url

**VK**:
1. video.save → получить upload_url
2. PUT binary video на upload_url
3. video.edit (title, description)
4. wall.post с attachment video{owner_id}_{video_id}

**Threads**:
1. OAuth refresh → access token
2. POST /me/threads (media_container, media_type=VIDEO)
3. POST /me/threads_publish (creation_id)

**Rutube**:
1. API key auth
2. Инициализация загрузки → части → финализация → публикация

### 9.3 FFmpeg.wasm обрезка

Если видео превышает max_video_duration_sec платформы:
1. R2.get(songs/{id}.mp4) → ArrayBuffer
2. FFmpeg.wasm trim (-t maxDurationSec -c copy)
3. Сохранить в R2: songs/{id}-trimmed.mp4
4. Добавить "(Abridged)" в title/description

Fallback: пропустить платформу (status=skipped).

### 9.4 Cron — триггер кросс-постинга

```
08:00 UTC+3 ежедневно:
  → Запросить песни за последние 24ч без cross_post_status
  → Для каждой × каждую enabled платформу:
     → INSERT cross_post_status (pending)
     → Отправить в Queue: { action: 'crosspost', songId, platform, crossPostId }
```

### 9.5 Admin endpoints

```
GET/POST       /api/admin/crosspost-config              — CRUD
PUT/DELETE     /api/admin/crosspost-config/:id          — CRUD
GET            /api/admin/crosspost-status               — список (фильтры)
GET            /api/admin/crosspost-status/:id           — детали
POST           /api/admin/crosspost/publish              — ручной триггер
POST           /api/admin/crosspost/retry                — повтор
```

### 9.6 Обработка ошибок

| Ситуация | Действие |
|----------|----------|
| OAuth token expired | refresh; при неудаче → failed |
| Video > limit | FFmpeg.wasm trim; при ошибке → skipped |
| API 429 (rate limit) | retry через 1ч |
| API 403 (no rights) | failed, не retry |
| upload timeout | retry через 30мин |
| R2 video не найден | skipped |

### 9.7 Задачи

- [ ] Создать миграцию 010
- [ ] Worker: cross_post_config CRUD
- [ ] Worker: cross_post_status CRUD
- [ ] Worker: queue consumer — YouTube
- [ ] Worker: queue consumer — VK
- [ ] Worker: queue consumer — Threads
- [ ] Worker: queue consumer — Rutube
- [ ] Worker: FFmpeg.wasm обрезка
- [ ] Worker: cron триггер кросс-постинга
- [ ] Worker: admin publish/retry endpoints
- [ ] Frontend админки: панель управления платформами
- [ ] Frontend админки: статусы кросс-постов

---

## 10. Этап 8: Аналитика

### 10.1 Queue consumer — collectPlatformAnalytics()

```
Для каждой платформы в cross_post_config WHERE enabled=1:
  → Для каждого cross_post_status WHERE platform=? AND status='published':
     === YouTube ===
       → GET videos.list?part=statistics&id={platform_post_id}
       → views, likes, comments
     === VK ===
       → GET video.get?videos={owner_id}_{video_id}
       → views, likes, comments, shares
     === Threads ===
       → GET /me/threads?fields=like_count,comments_count,views_count
       → views, likes, comments
     === Rutube ===
       → GET /api/video/{id}/stat/
       → views, likes, comments, shares
     === Telegram ===
       → Пропустить (нет API статистики)
  → INSERT analytics_snapshots (song_id, platform, snapshot_date, ...)
  → ON CONFLICT(song_id, platform, snapshot_date) DO UPDATE
```

### 10.2 Рейтинг песен

После сбора аналитики — пересчёт рейтинга:

```sql
UPDATE songs SET rating = (
  SELECT AVG(
    COALESCE(LOG10(views + 1), 0) * 0.4 +
    COALESCE(LOG10(likes + 1), 0) * 0.3 +
    COALESCE(LOG10(comments_count + 1), 0) * 0.2 +
    COALESCE(LOG10(shares + 1), 0) * 0.1
  )
  FROM analytics_snapshots
  WHERE song_id = songs.id
    AND snapshot_date >= DATE('now', '-30 days')
), rating_updated_at = datetime('now')
WHERE id IN (SELECT DISTINCT song_id FROM analytics_snapshots);
```

### 10.3 Admin endpoints

```
GET /api/admin/analytics/snapshots — фильтры: song_id, platform, date_from, date_to
GET /api/admin/analytics/rating    — топ песен по рейтингу (sorted DESC)
```

### 10.4 Frontend админки

- Таблица аналитики: песня, платформа, просмотры, лайки, комментарии
- График рейтинга по дням
- Топ-10 песен по рейтингу

### 10.5 Задачи

- [ ] Worker: queue consumer — сбор аналитики с YouTube
- [ ] Worker: queue consumer — сбор аналитики с VK
- [ ] Worker: queue consumer — сбор аналитики с Threads
- [ ] Worker: queue consumer — сбор аналитики с Rutube
- [ ] Worker: пересчёт рейтинга
- [ ] Worker: admin endpoints аналитики
- [ ] Frontend админки: таблица + графики аналитики

---

## 11. Миграции D1 (полный список)

### 001_create_tables.sql ✅ (выполнена)
```sql
CREATE TABLE songs (...), audio_breakdowns (...), settings (...), admin_sessions (...)
```

### 002_add_tg_file_id.sql ✅
```sql
ALTER TABLE songs ADD COLUMN tg_file_id TEXT;
```

### 003_create_messages.sql ✅
```sql
CREATE TABLE messages (...)
```

### 004_add_cover_fields.sql ✅
```sql
ALTER TABLE songs ADD COLUMN cover_url TEXT;
ALTER TABLE messages ADD COLUMN cover_file_id TEXT;
ALTER TABLE messages ADD COLUMN cover_url TEXT;
```

### 005_add_indexes.sql ✅
```sql
CREATE INDEX ... ON audio_breakdowns(song_id);
CREATE INDEX ... ON messages(forward_from_msg_id);
CREATE INDEX ... ON messages(reply_to_msg_id);
CREATE INDEX ... ON messages(chat_type);
```

### 006_add_song_fields.sql ⏳ (готова, не выполнена)
```sql
ALTER TABLE songs ADD COLUMN suno_title TEXT;
ALTER TABLE songs ADD COLUMN description TEXT;
ALTER TABLE songs ADD COLUMN r2_video_url TEXT;
ALTER TABLE songs ADD COLUMN r2_migratable INTEGER DEFAULT 1;
ALTER TABLE songs ADD COLUMN pending_review INTEGER DEFAULT 0;
ALTER TABLE songs ADD COLUMN pending_metadata TEXT;
ALTER TABLE songs ADD COLUMN metadata_source TEXT DEFAULT 'telegram';
CREATE INDEX IF NOT EXISTS idx_songs_visible_title ON songs(visible, title);
```

### 007_create_extra_audio.sql ⏳ (готова, не выполнена)
```sql
CREATE TABLE extra_audio (...);
INSERT INTO extra_audio SELECT ... FROM audio_breakdowns;
DROP TABLE audio_breakdowns;
```

### 008_create_external_links.sql ⏳ (готова, не выполнена)
```sql
CREATE TABLE external_link_types (...);
CREATE TABLE song_external_links (...);
INSERT INTO external_link_types VALUES ('Instagram', '📷', 1), ('TikTok', '🎵', 2), ('VK', '💬', 3);
```

### 009_create_metadata_reviews.sql ⏳ (готова, не выполнена)
```sql
CREATE TABLE metadata_reviews (...);
CREATE INDEX ... ON metadata_reviews(song_id);
CREATE INDEX ... ON metadata_reviews(status);
```

### 010_create_crosspost_analytics.sql ⏳ (проект)
```sql
CREATE TABLE cross_post_config (...);
CREATE TABLE cross_post_status (...);
CREATE TABLE analytics_snapshots (...);
ALTER TABLE songs ADD COLUMN rating REAL DEFAULT 0;
ALTER TABLE songs ADD COLUMN rating_updated_at TEXT;
INSERT INTO cross_post_config VALUES (...pre-populated 5 platforms...);
```

---

## 12. Worker secrets

### Существующие

| Secret | Назначение | Установлен? |
|--------|------------|-------------|
| TELEGRAM_BOT_TOKEN | Токен бота @ShemaxPoetryBot | ✅ |
| ADMIN_PASSWORD | Пароль для входа в админку | ✅ |
| TURNSTILE_SECRET_KEY | Secret key для Cloudflare Turnstile (из dashboard) | ✅ |
| WEBHOOK_SECRET | Секрет для верификации вебхуков | ❌ (не обязателен) |
| ALERT_CHAT_ID | Telegram chat ID для отправки алертов (мониторинг) | ❌ |

### Новые (для кросс-постинга)

| Secret | Платформа | Назначение |
|--------|-----------|------------|
| CP_YOUTUBE_REFRESH | YouTube | OAuth refresh token |
| CP_YOUTUBE_CLIENT_ID | YouTube | OAuth Client ID |
| CP_YOUTUBE_CLIENT_SECRET | YouTube | OAuth Client Secret |
| CP_YOUTUBE_CHANNEL_ID | YouTube | ID канала |
| CP_VK_ACCESS_TOKEN | VK | Бессрочный access token |
| CP_VK_GROUP_ID | VK | ID сообщества |
| CP_THREADS_REFRESH | Threads | OAuth refresh token |
| CP_THREADS_ACCESS_TOKEN | Threads | Текущий access token |
| CP_RUTUBE_API_KEY | Rutube | API ключ |

---

## 13. Обновление wrangler.jsonc

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
  "name": "poetry",
  "main": "src/worker.js",
  "compatibility_date": "2026-07-04",
  "compatibility_flags": ["nodejs_compat"],
  "account_id": "02a5ee785952a4e4b7b6da209e10c53d",
  "d1_databases": [{
    "binding": "DB",
    "database_name": "SHEMAX_DB",
    "database_id": "9f979733-d291-4e4a-af29-7cb463ca534a"
  }],
  "kv_namespaces": [{
    "binding": "STATIC",
    "id": "fd50e45d91a6485b944e69056960dccd"
  }],
  "r2_buckets": [{
    "binding": "MEDIA",
    "bucket_name": "shemaxpoetry"
  }],
  "queues": [{
    "binding": "UPLOAD_QUEUE",
    "queue": "shemax-uploads"
  }],
  "triggers": {
    "crons": ["0 8 * * *"]
  }
}
```

---

## 14. Фронтенд — полный список изменений

### ✅ Уже реализовано (безопасность)

- `public/admin/index.html`: Turnstile widget (`#turnstileWidget`) в форме логина, скрипт API `https://challenges.cloudflare.com/turnstile/v0/api.js`
- `public/admin/index.html`: CSP meta-tag для админки (разрешает `challenges.cloudflare.com`)
- `public/js/admin.js`: `handleLogin()` — отправляет Turnstile token на `/api/admin/login`, при ошибке вызывает `turnstile.reset()`
- `public/js/admin.js`: `openPlayer()` — переписан с `innerHTML` на `createElement`/`appendChild` с ручным escaping (XSS fix)
- `public/index.html`: ссылка "Политика конфиденциальности" добавлена в секцию About (i18n: `privacy`)
- `public/js/i18n.js`: добавлен ключ `privacy`

### Ещё нужно реализовать

### public/index.html

- Заголовок "Shemaxpoetry" обернуть в `<a href="https://t.me/shemaxpoetry">`
- Добавить поле поиска (input + debounce)
- Добавить фильтр языка

### public/js/app.js

- `togglePodcast()` — resume position (podcastReturnIndex, podcastReturnTime)
- Показывать "✕" на кнопке подкаста при активном подкасте
- Если >1 подкаст — popup выбора
- Иконка 🔗 для песен с external_link_count > 0
- Popup с внешними ссылками
- Поиск: обновление списка при вводе (debounce 300ms)
- Фильтр языка

### public/admin/index.html

- Раздел "External Links" в карточке песни
- Кнопка "Migrate to R2" (вызов /api/admin/migrate-to-r2)
- Раздел "Metadata Reviews" (pending review diff/apply/reject)
- Раздел "Cross-post Config" (список платформ, enabled/disabled)
- Раздел "Cross-post Status" (статусы публикаций)
- Раздел "Analytics" (таблица + графики)
- Индикатор "🟡 Pending review" для песен
- Добавить колонку rating в таблицу песен

### public/js/admin.js

- CRUD внешних ссылок (editSong — добавить/удалить)
- Cross-post config CRUD
- Cross-post publish/retry
- Analytics snapshots + rating display

---

## 15. Порядок деплоя

### Шаг 1: Инфраструктура (Dashboard)

1. [ ] Создать Turnstile widget в dash.cloudflare.com → получить Site Key / Secret Key
2. [ ] Включить R2: https://dash.cloudflare.com/?to=/:account/r2/overview
3. [ ] Создать Queue: https://dash.cloudflare.com/?to=/:account/queues
4. [ ] Установить Worker secrets (TELEGRAM_BOT_TOKEN, ADMIN_PASSWORD, TURNSTILE_SECRET_KEY)

### Шаг 2: Безопасность ✅ (уже реализовано в коде)

1. [x] Security headers (все ответы)
2. [x] Rate limiting (публичный API 100/мин, админка 20/мин, login 5/мин, webhook 30/мин)
3. [x] Error sanitization (внутренние ошибки не уходят клиенту)
4. [x] Input validation (все эндпоинты)
5. [x] CORS (админка — только домен worker)
6. [x] API stripping (лишние поля не возвращаются)
7. [x] Privacy policy (`/privacy`)
8. [x] Turnstile (требуется создание виджета + установка Site Key)
9. [x] XSS защита (escapeHtml, DOM API вместо innerHTML)

### Шаг 3: Миграции

```bash
npm run migrate
# Выполнит 006 → 007 → 008 → 009 → 010
```

### Шаг 4: Worker код

1. [ ] Написать queue consumer (R2 upload + crosspost + analytics)
2. [ ] Написать admin endpoints (все новые)
3. [ ] Написать обновлённый cron (три cron-задачи)
4. [ ] Обновить /api/media/:id (fallback chain)
5. [ ] Обновить webhook (дедупликация + отправка в очередь)
6. [ ] Тестировать локально: `npm run dev -- --test-scheduled`

### Шаг 5: Обновить Turnstile Site Key

Заменить `0x4AAAAAAA...` в `public/admin/index.html` на реальный Site Key из Turnstile dashboard.

### Шаг 6: Деплой worker

**Основной способ** — Workers Builds (авто при push в `master`):
```bash
git add -A && git commit -m "message" && git push
```

**Запасной способ** — через API (только для source ≤20KB):
```bash
node deploy.mjs
# ВНИМАНИЕ: PUT лимит 25KB — если source >25KB, команда упадёт с timeout
```

### Шаг 7: Деплой статики

```bash
# KV upload для каждого файла
npx wrangler kv key put --namespace-id fd50e45d91a6485b944e69056960dccd \
  index.html --path public/index.html --remote

npx wrangler kv key put --namespace-id fd50e45d91a6485b944e69056960dccd \
  js/app.js --path public/js/app.js --remote

npx wrangler kv key put --namespace-id 1994525bead042229fed7f2bd41d2f3a \
  js/admin.js --path public/js/admin.js --remote

npx wrangler kv key put --namespace-id 1994525bead042229fed7f2bd41d2f3a \
  admin/index.html --path public/admin/index.html --remote

npx wrangler kv key put --namespace-id 1994525bead042229fed7f2bd41d2f3a \
  css/style.css --path public/css/style.css --remote
```

### Шаг 7: Backfill

1. [ ] В админке: кнопка "Migrate to R2" — запустить backfill старых песен
2. [ ] Проверить через /api/admin/verify-db

### Шаг 8: Кросс-постинг

1. [ ] Зарегистрировать приложения на платформах
2. [ ] Установить Worker secrets (токены платформ)
3. [ ] В админке: включить платформы в cross_post_config
4. [ ] Ручной тест: POST /api/admin/crosspost/publish

### Шаг 9: Аналитика

1. [ ] Дождаться первого сбора аналитики (06:00 cron)
2. [ ] Проверить через GET /api/admin/analytics/snapshots
3. [ ] Проверить рейтинг через GET /api/admin/analytics/rating

---

## 16. Регистрация на платформах

### YouTube Data API

1. Перейти на https://console.cloud.google.com
2. Создать проект → "YouTube Data Project"
3. APIs & Services → Library → включить "YouTube Data API v3"
4. OAuth consent screen → External → заполнить App Name, User Support Email
5. Scopes: добавить `.../auth/youtube.upload`
6. Test users: добавить свой Google-аккаунт
7. Credentials → Create Credentials → OAuth 2.0 Client ID → Desktop application
8. Скачать JSON (там client_id, client_secret)
9. Получить refresh token (через Google OAuth Playground или скрипт)
10. Сохранить в Worker secrets: CP_YOUTUBE_CLIENT_ID, CP_YOUTUBE_CLIENT_SECRET, CP_YOUTUBE_REFRESH, CP_YOUTUBE_CHANNEL_ID

### VK API

1. Перейти на https://vk.com/dev
2. Создать приложение → Standalone-приложение (название "ShemaxPoetry Crosspost")
3. Получить ID приложения (APP_ID)
4. Открыть в браузере:
   ```
   https://oauth.vk.com/authorize?client_id={APP_ID}&display=page
   &redirect_uri=https://oauth.vk.com/blank.html
   &scope=video,wall,groups,offline&response_type=token
   ```
5. Скопировать access_token из URL (после #)
6. Сохранить в Worker secrets: CP_VK_ACCESS_TOKEN
7. Если постинг от группы: CP_VK_GROUP_ID = ID сообщества

### Threads API

1. Создать Instagram Professional аккаунт
2. Привязать Threads аккаунт
3. Перейти на https://developers.facebook.com
4. Создать приложение → Business → "ShemaxPoetry Threads"
5. Добавить продукт "Instagram Graph API"
6. Добавить "Threads" (в разделе продуктов)
7. Настроить App Review → получить Page access token
8. Обменять на долгоживущий токен (60 дней)
9. Сохранить в Worker secrets: CP_THREADS_ACCESS_TOKEN, CP_THREADS_REFRESH

### Rutube API

1. Заполнить заявку на https://rutube.ru/promo/api/
2. Дождаться ответа от партнёрского отдела
3. Получить API key и документацию
4. Сохранить в Worker secrets: CP_RUTUBE_API_KEY

---

## 17. Целевая аудитория и роли

### 17.1 Роли пользователей

| Роль | Описание | Доступ |
|------|----------|--------|
| **Слушатель** (гость) | Любой посетитель сайта | Просмотр и прослушивание песен, подкастов, поиск, фильтрация |
| **Администратор** | Владелец проекта Shemax | Полный CRUD песен, синхронизация, управление платформами, аналитика |

### 17.2 Сценарии использования (Use Cases)

| Сценарий | Роль | Описание |
|----------|------|----------|
| Прослушать песню | Слушатель | Открыть сайт → выбрать песню → нажать Play |
| Искать песню | Слушатель | Ввести текст в поиск → отфильтровать по языку |
| Слушать подкаст | Слушатель | Нажать кнопку подкаста на песне → слушать → вернуться к песне |
| Перейти по внешней ссылке | Слушатель | Нажать иконку 🔗 → открыть YouTube/Instagram/TikTok |
| Войти в админку | Администратор | Перейти на /admin → ввести пароль → Turnstile verify |
| Добавить/редактировать песню | Администратор | Админка → форма песни → сохранить |
| Синхронизировать метаданные | Администратор | Нажать "Sync Suno" → подтвердить изменения |
| Управлять кросс-постингом | Администратор | Включить/выключить платформы → запустить публикацию |
| Просматривать аналитику | Администратор | Графики просмотров, рейтинг песен |

### 17.3 User Flow — Слушатель

```
1. Открыть https://poetry.shemax.workers.dev
2. Видит список песен (с пагинацией/поиском)
3. Выбирает песню
4. Видео/аудио начинает играть
5. Может: искать, фильтровать, слушать подкаст, перейти по ссылкам
6. Может: открыть политику конфиденциальности
```

### 17.4 User Flow — Администратор

```
1. Перейти на /admin
2. Ввести пароль + пройти Turnstile
3. Панель: таблица песен, кнопки действий
4. Может: CRUD, синхронизация, сканирование канала, верификация
5. Может: управлять метаданными, кросс-постингом, аналитикой
```

---

## 18. Требования к производительности (SLA)

### 18.1 Время ответа

| Метрика | Целевое значение | Критично |
|---------|-----------------|----------|
| GET /api/songs p50 | <200ms | Да |
| GET /api/songs p95 | <500ms | Да |
| GET /api/media/:id p50 | <100ms (R2 redirect) / <500ms (Telegram fallback) | Да |
| TTFB (Time to First Byte) | <1.5s | Да |
| FCP (First Contentful Paint) | <2s | Средне |
| Загрузка видео (playback start) | <3s на R2 / <5s на Telegram fallback | Средне |

### 18.2 Нагрузка

| Параметр | Значение |
|----------|----------|
| Одновременные пользователи | ~100 |
| Запросов в минуту (пик) | ~300 |
| Ежедневные уникальные посетители | ~500 |
| Размер БД | ~500 песен, ~500 сообщений |

### 18.3 Ограничения платформы (Cloudflare Free Tier)

| Ресурс | Лимит | Мониторинг |
|--------|-------|------------|
| Workers CPU | 10ms per request | Cloudflare dashboard |
| Workers subrequests | 1000 per request | В коде — ограничить пагинацию |
| D1 reads | 5 млн / день | Превышение → 503 |
| KV reads | 100k / день | Превышение → кэш отключается |
| Queue ops | 10k / день | Превышение → сообщения теряются |
| R2 storage | 10GB | При достижении 8GB → алерт |

### 18.4 Стратегия при превышении лимитов

| Ресурс | Действие |
|--------|----------|
| D1 reads близко к лимиту | Включить агрессивное KV-кэширование (TTL=1ч) |
| KV reads близко к лимиту | Отключить кэш Suno, оставить только статику |
| Queue ops | Отключить неважные задачи (аналитика) |
| R2 storage > 8GB | Старые песни → fallback на Telegram, новые — в R2 |

---

## 19. Требования к совместимости

### 19.1 Браузеры (последние 2 версии)

| Браузер | Версии | Примечание |
|---------|--------|------------|
| Google Chrome | >= 122 | Основной браузер |
| Mozilla Firefox | >= 123 | Полная поддержка |
| Apple Safari | >= 17.4 | Включая iOS Safari |
| Microsoft Edge | >= 122 | Chromium-based |

### 19.2 Устройства

| Тип | Экран | ОС |
|-----|-------|----|
| Desktop | >= 1024px | Windows, macOS, Linux |
| Tablet | 768px – 1023px | iPadOS, Android |
| Mobile | 320px – 767px | iOS, Android |
| Telegram WebView | Все размеры | Embedded браузер |

### 19.3 Протоколы и форматы

- HTTP/2, HTTPS (TLS 1.2+)
- Video: MP4 (H.264)
- Audio: MP3, M4A, OGG
- Images: JPEG, PNG, WebP
- API: JSON (REST-like)
- Кодировка: UTF-8

### 19.4 Сетевые требования

- CDN: Cloudflare (встроен в Worker)
- DNS: Cloudflare DNS (через домен workers.dev)
- Доступность: 99.5% (соответствует free tier Cloudflare)

---

## 20. Требования к доступности (WCAG AA)

### 20.1 Целевой стандарт

WCAG 2.1 Level AA (ISO/IEC 40500)

### 20.2 Принципы и критерии

| Принцип | Требование | Реализация |
|---------|------------|------------|
| **Воспринимаемость** | Все нетекстовое содержимое имеет текстовый эквивалент | `alt` на cover, `aria-label` на кнопках |
| **Воспринимаемость** | Цвет не единственное средство передачи информации | Иконки + текст, не только цвет |
| **Воспринимаемость** | Контраст текста ≥ 4.5:1 | Проверить через Lighthouse |
| **Управляемость** | Все функции доступны с клавиатуры | Tab, Enter, Space на элементах плеера |
| **Управляемость** | Фокус виден (`:focus-visible`) | Outline на всех интерактивных элементах |
| **Понятность** | Язык страницы указан | `<html lang="ru">` |
| **Понятность** | Сообщения об ошибках понятны | Русский язык в UI |
| **Надёжность** | Правильные ARIA-роли | `role="application"` на плеере, `role="button"` на элементах |

### 20.3 Список элементов для доработки

- [ ] `public/index.html`: `<html lang="ru">`, мета-описание
- [ ] `public/index.html`: `aria-label` на кнопках плеера (play, pause, next, podcast, search)
- [ ] `public/index.html`: `alt` на всех обложках
- [ ] `public/css/style.css`: стили `:focus-visible` для всех интерактивных элементов
- [ ] `public/js/app.js`: клавиатурные обработчики (Space = play/pause, ArrowLeft/Right = prev/next)
- [ ] `public/admin/index.html`: `aria-label` на формах, кнопках
- [ ] Проверить контрастность через Chrome Lighthouse

---

## 21. Требования к SEO

### 21.1 Метаданные

| Элемент | Требование | Где |
|---------|------------|-----|
| `<title>` | Динамический: "ShemaxPoetry — {название песни}" | В `app.js` при выборе песни |
| `<meta name="description">` | "Поэзия и песни Shemax | Osintsev's poetry" | В `index.html` |
| `<meta name="keywords">` | "shemax poetry, osintsev, стихи, песни, поэзия" | В `index.html` |
| `<meta name="viewport">` | `width=device-width, initial-scale=1` | ✅ Уже есть |
| `<html lang="ru">` | Указан язык | В `index.html` |
| Canonical URL | `<link rel="canonical" href="...">` | В `index.html` |

### 21.2 Open Graph / Twitter Card

| Тег | Значение |
|-----|----------|
| `og:title` | "ShemaxPoetry" |
| `og:description` | "Поэзия и песни Shemax" |
| `og:type` | `website` |
| `og:url` | `https://poetry.shemax.workers.dev` |
| `og:image` | URL обложки / логотипа |
| `og:locale` | `ru_RU` |
| `twitter:card` | `summary_large_image` |
| `twitter:title` | "ShemaxPoetry" |

### 21.3 Структурированные данные (Schema.org)

```json
{
  "@context": "https://schema.org",
  "@type": "MusicAlbum",
  "name": "ShemaxPoetry",
  "byArtist": {
    "@type": "Person",
    "name": "Shemax (Osintsev)"
  },
  "genre": ["Poetry", "Music"]
}
```

Добавить в `index.html` как `<script type="application/ld+json">`.

### 21.4 Sitemap и robots

- `robots.txt`: разрешить всё, указать sitemap
- `sitemap.xml`: генерировать динамически (или статический список всех песен)

```
GET /robots.txt → Worker route
GET /sitemap.xml → Worker route (генерируется из D1: SELECT id, updated_at FROM songs WHERE visible=1)
```

### 21.5 Задачи

- [ ] Добавить meta tags в `public/index.html`
- [ ] Добавить Open Graph / Twitter Card теги
- [ ] Добавить Schema.org JSON-LD
- [ ] Создать Worker route для `/robots.txt`
- [ ] Создать Worker route для `/sitemap.xml` (динамический)
- [ ] Проверить через Google Rich Results Test

---

## 22. Правовые аспекты

### 22.1 Политика конфиденциальности (Privacy Policy)

**Статус**: ✅ Реализовано (`/privacy` route + `public/index.html` ссылка)

Содержит:
- Какие данные собираются (file_id, browser info, логи)
- Как используются и хранятся
- Права пользователей (GDPR, CCPA)
- Контактные данные

### 22.2 Пользовательское соглашение (Terms of Service)

**Статус**: ❌ Не реализовано

Требуемые разделы:
1. Общие положения
2. Описание сервиса
3. Права и обязанности пользователя
4. Права и обязанности администрации
5. Ответственность сторон
6. Интеллектуальная собственность (контент Shemax)
7. Прекращение доступа
8. Применимое право
9. Контакты

Реализация:
- Создать `/terms` route в `worker.js`
- Страница на русском языке
- Ссылка в футере `public/index.html`

### 22.3 DMCA / Copyright

**Статус**: ❌ Не реализовано

Требуемые разделы:
1. Уважение авторских прав
2. Процедура подачи жалобы на нарушение
3. Информация, необходимая для жалобы
4. Контакты для DMCA-агента
5. Counter-notification процедура

Реализация:
- Создать `/dmca` route в `worker.js`
- Страница на русском + английском
- Ссылка в футере `public/index.html`

### 22.4 Задачи

- [ ] Написать и добавить `/terms` route + страница
- [ ] Написать и добавить `/dmca` route + страница
- [ ] Добавить ссылки в футер `public/index.html`

---

## 23. Требования к тестированию и приёмке

### 23.1 Уровни тестирования

| Уровень | Инструмент | Что тестируем |
|---------|-----------|---------------|
| Модульное (unit) | Vitest | `db.js`, `utils.js`, `services.js` — чистая логика |
| Интеграционное | Vitest + miniflare | Worker эндпоинты (fetch), D1 запросы |
| E2E (UI) | Вручную + Lighthouse | Плеер, поиск, админка |
| Безопасность | Ручной аудит | Rate limit, CORS, headers, SQL-инъекции |
| Нагрузочное | wrangler dev + ab/siege | Проверка SLA |

### 23.2 Acceptance criteria для каждого этапа

| Этап | Критерий приёмки |
|------|------------------|
| **Этап 0 (Фундамент)** | R2 bucket создан, Queue создана, wrangler.jsonc обновлён, миграции выполнены |
| **Этап 1 (R2 Upload)** | Песня по webhook → сохраняется в D1 + ставится в очередь → R2 содержит mp4 → `/api/media/:id` отдаёт 302 на R2 |
| **Этап 2 (Suno)** | Cron обновляет метаданные, diff сохраняется, admin approve/reject работает |
| **Этап 3 (Поиск)** | `/api/songs?search=...` возвращает отфильтрованные результаты с debounce |
| **Этап 4 (Podcast)** | `extra_audio` таблица создана, resume position работает, admin CRUD работает |
| **Этап 5 (Ссылки)** | Внешние ссылки сохраняются, отображаются иконкой 🔗, popup работает |
| **Этап 6 (Webhook)** | Дубликаты не создаются, структурированные логи во всех обработчиках |
| **Этап 7 (Кросс-постинг)** | Платформа включена → песня публикуется → статус `published` |
| **Этап 8 (Аналитика)** | Снапшоты собираются, рейтинг пересчитывается, графики отображаются |
| **Безопасность** | Все 11 пунктов чеклиста выполнены, Turnstile работает, audit пройден |

### 23.3 Чеклист перед деплоем

- [ ] Все unit-тесты проходят
- [ ] Rate limiter не блокирует легитимные запросы
- [ ] CORS настроен правильно (админка ≠ публичный API)
- [ ] Security headers присутствуют на всех ответах
- [ ] Privacy policy, ToS, DMCA доступны
- [ ] WCAG-базовые проверки пройдены (контраст, клавиатура, aria)
- [ ] SEO-теги присутствуют
- [ ] Логи пишутся во все ключевые события
- [ ] Deploy прошёл без ошибок
- [ ] Smoke-test: открыть сайт → найти песню → проиграть → открыть админку

---

## 24. Бюджет и лимиты (Free Tier)

### 24.1 Cloudflare Free Tier — ожидаемое потребление

| Сервис | Ожидаемое usage/день | Лимит/день | Запас |
|--------|---------------------|------------|-------|
| Workers requests | ~1000 | 100k | 100x |
| Workers CPU time | ~500ms | 10ms/req (10s/day) | Достаточно |
| D1 reads | ~1000 | 5M | 5000x |
| D1 writes | ~50 | 100k | 2000x |
| D1 storage | ~50MB | 5GB | 100x |
| KV reads (statics) | ~200 | 100k | 500x |
| KV reads (Suno cache) | ~50 | 100k | 2000x |
| KV storage | ~100KB | 1GB | 10000x |
| Queue ops | ~100 | 10k | 100x |
| R2 storage | ~5GB (цель) | 10GB | 2x |
| R2 Class A ops | ~10 | 1M | 100000x |
| R2 Class B ops | ~1000 | 10M | 10000x |

### 24.2 План при превышении free tier

| Ситуация | Действие |
|----------|----------|
| R2 storage > 8GB | Автоматический fallback старых песен на Telegram getFile |
| R2 storage > 10GB | Вручную удалить наименее популярные mp4, оставить ссылки на Telegram |
| D1 writes близко к лимиту | Отключить аналитику (она пишет снапшоты) |
| Queue ops > 8k/day | Отключить кросс-постинг для второстепенных платформ |
| Любой лимит превышен | Логировать в Workers Logs, отправить алерт в Telegram |

---

## 25. CI/CD и качество кода

### 25.1 Стандарты кода

| Требование | Инструмент | Статус |
|------------|-----------|--------|
| Форматирование JS | `prettier` (single quote, semicolon, tabWidth=2) | ❌ Не настроено |
| Линтер JS | `eslint` (рекомендуемые правила + node + browser envs) | ❌ Не настроено |
| Типизация | JSDoc-комментарии на экспортируемых функциях | ❌ Не настроено |
| .editorconfig | `indent_style=space, indent_size=2, charset=utf-8` | ❌ Не настроено |

### 25.2 Workers Builds (CI/CD) — основной способ деплоя

Настроен через Dashboard Cloudflare. **Деплой автоматический при каждом push в `master`.**

| Параметр | Значение |
|----------|----------|
| Репозиторий | `Shemax13/Singingpoetry` |
| Ветка | `master` |
| Deploy command | `npx wrangler deploy` |
| Build command | (пусто) |
| Root directory | `/` |

**Процесс деплоя:**
1. `npm clean-install` (168 packages, 0 vulnerabilities)
2. `npx wrangler deploy` → Upload: 81.16 KiB / gzip: 16.57 KiB
3. Worker Startup Time: 4 ms
4. URL: `https://poetry.shemaxpoetry.workers.dev`
5. Schedule: `0 8 * * *`

**Критическое ограничение — API 25KB PUT limit:**
- Прямой вызов Cloudflare API `PUT /workers/scripts/{name}` таймаутится при >25KB
- Source ≤20KB → успех (~2.7s), source ≥25KB → timeout
- Workers Builds **обходит** лимит (сборка внутри Cloudflare)

### 25.3 GitHub Actions Pipeline (запасной способ)

```yaml
# ВНИМАНИЕ: deploy.mjs использует CLOUDFLARE_API_TOKEN для прямого PUT
# Работает только для source ≤20KB. Для полного деплоя — Workers Builds.
name: CI/CD
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx prettier --check 'src/**/*.js'
      - run: npx eslint 'src/**/*.js'

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx vitest run

  deploy:
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/master'
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: node deploy.mjs
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### 25.4 Pre-commit hooks

```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "npx prettier --check 'src/**/*.js' && npx eslint 'src/**/*.js'"
    }
  }
}
```

### 25.5 Задачи

- [x] Настроить Workers Builds (Dashboard Cloudflare) — основной деплой
- [ ] Установить и настроить prettier, eslint, editorconfig
- [ ] Добавить JSDoc на экспортируемые функции в `src/*.js`
- [ ] Настроить pre-commit hooks (husky)

---

## 26. Мониторинг и алерты

### 26.1 Уровни мониторинга

| Уровень | Инструмент | Что отслеживаем |
|---------|-----------|-----------------|
| Логи | Cloudflare Workers Logs | Все `console.log()` вызовы |
| Метрики | Cloudflare Dashboard | Requests, CPU, Errors, Bandwidth |
| uptime | Cloudflare Dashboard (0% downtime) | Worker доступность |
| Алерты | Telegram bot @ShemaxPoetryBot | Ошибки, превышение лимитов |

### 26.2 Ключевые метрики для отслеживания

| Метрика | Где смотреть | Триггер алерта |
|---------|-------------|----------------|
| Worker errors (5xx) | Dashboard → Workers | > 1% за 5 минут |
| D1 query errors | Workers Logs | Любая ошибка SQL |
| Rate limit hits (429) | Workers Logs | > 10 за час |
| Telegram API errors | Workers Logs | > 3 подряд |
| R2 upload failures | Workers Logs | > 2 подряд |
| Webhook failures | Workers Logs | Любой сбой |
| D1 reads approaching limit | Dashboard → D1 | > 4M за день |
| R2 storage | Dashboard → R2 | > 8GB |
| Queue dead letters | Dashboard → Queues | > 0 |

### 26.3 Telegram-алерты

```javascript
// В worker.js — функция отправки алерта
async function sendAlert(env, level, message) {
  var TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  var CHAT_ID = env.ALERT_CHAT_ID; // Личный Telegram ID

  if (!CHAT_ID || !TELEGRAM_BOT_TOKEN) return;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: `[${level}] ShemaxPoetry: ${message}`,
      parse_mode: 'HTML'
    })
  });
}
```

Новый secret: `ALERT_CHAT_ID` — Telegram chat ID администратора для алертов.

### 26.4 Места для алертов в коде

| Место | Уровень | Сообщение |
|-------|---------|-----------|
| webhook handler, catch блок | error | "Webhook processing failed: {error}" |
| queue consumer, все catch | error | "Queue task failed: {action} — {error}" |
| Suno sync | warn | "Suno API unavailable, using cache" |
| Rate limit превышение | warn | "Rate limit hit: {ip} on {endpoint}" |
| D1 ошибка | error | "Database query failed: {query}" |
| Upload queue dead letter | critical | "Message moved to DLQ after 3 retries" |

### 26.5 Задачи

- [ ] Реализовать `sendAlert()` в worker.js
- [ ] Установить secret `ALERT_CHAT_ID`
- [ ] Добавить алерты во все catch-блоки
- [ ] Настроить Workers Logs retention (по умолчанию 3 дня — достаточно)

---

## 27. План отката (Rollback)

### 27.1 Rollback Worker кода

```bash
# Вариант 1: Через deploy.mjs с предыдущей версией
# Сохранять предыдущий bundle перед деплоем
cp dist/worker.js dist/worker.js.bak
node deploy.mjs
# При ошибке:
node deploy.mjs --source dist/worker.js.bak

# Вариант 2: Через Cloudflare Dashboard
# Dashboard → Workers → poetry → Deployments → выбрать предыдущую версию

# Вариант 3: Через wrangler (если работает)
npx wrangler rollback
```

### 27.2 Rollback статики (KV)

```bash
# KV не версионируется, поэтому backup:
# Перед деплоем новой версии — сохранить текущую:
npx wrangler kv key get --namespace-id 1994525bead042229fed7f2bd41d2f3a \
  index.html --remote > backup/index.html.bak

# Откат — перезаписать предыдущей версией:
npx wrangler kv key put --namespace-id 1994525bead042229fed7f2bd41d2f3a \
  index.html --path backup/index.html.bak --remote
```

### 27.3 Rollback миграций D1

D1 не поддерживает `ROLLBACK` миграции. Стратегия:

```bash
# 1. Откатить Worker код до версии до миграции
# 2. Создать компенсирующую миграцию (migration 011_revert_010.sql)
#    DROP TABLE ... / ALTER TABLE ... DROP COLUMN ...
# 3. Применить: npm run migrate
```

Правила:
- **Миграции 001-005**: Не откатывать (базовые таблицы, данные потеряются)
- **Миграции 006-009**: Если не применялись → не применять. Если применили → компенсирующая миграция
- **Миграция 010**: Если не применялась → отложить до готовности кросс-постинга

### 27.4 Rollback Queue и R2

| Ресурс | Действие при сбое |
|--------|-------------------|
| Queue | Удалить очередь `shemax-uploads` → создать заново. Необработанные сообщения теряются. |
| R2 bucket | Не удалять (данные). Новые ключи не конфликтуют со старым кодом. |
| Worker secrets | Просто переустановить старые значения. |

### 27.5 Процедура экстренного отката

```bash
# 1. Откатить Worker (занимает ~30s)
npx wrangler rollback

# 2. Откатить статику KV (занимает ~1min)
#    Запустить скрипт restore-kv.sh

# 3. Проверить health endpoint
curl -I https://poetry.shemax.workers.dev/api/songs

# 4. Уведомить (если есть алерт-канал)
```

### 27.6 Задачи

- [ ] Создать `backup/` директорию
- [ ] Написать скрипт `scripts/backup-kv.sh` (сохраняет все KV ключи)
- [ ] Написать скрипт `scripts/restore-kv.sh`
- [ ] Настроить автоматический backup KV перед каждым deploy в CI/CD
- [ ] Документировать rollback процедуру в README

---

## 28. Документация пользователя

### 28.1 Краткое описание интерфейса

Проект **ShemaxPoetry** — это музыкальный плеер для песен и поэзии Shemax (Osintsev).

**Основные возможности:**
- Прослушивание песен (видео + аудио)
- Поиск по названию и тексту
- Фильтрация по языку (русский / английский)
- Подкасты (дополнительные аудио-версии песен)
- Внешние ссылки на YouTube, Instagram, TikTok, VK
- Автоматический импорт из Telegram-канала @shemaxpoetry

### 28.2 Для слушателя

| Действие | Как сделать |
|----------|-------------|
| Найти песню | Ввести текст в поле поиска вверху страницы |
| Отфильтровать по языку | Нажать на переключатель ru/en |
| Послушать песню | Нажать на песню в списке или кнопку Play |
| Послушать подкаст | Нажать кнопку 🎧 на карточке песни |
| Открыть внешние ссылки | Нажать иконку 🔗 на карточке песни |
| Перейти в Telegram | Нажать на заголовок "Shemaxpoetry" |
| Узнать о конфиденциальности | Открыть ссылку "Политика конфиденциальности" внизу |
| Читать пользовательское соглашение | Открыть ссылку "Пользовательское соглашение" внизу |

### 28.3 Для администратора

| Действие | Как сделать |
|----------|-------------|
| Войти в админку | Перейти на `/admin`, ввести пароль |
| Добавить песню | CRUD форма — заполнить поля → сохранить |
| Редактировать песню | Нажать на песню в таблице → изменить → сохранить |
| Синхронизировать Suno | Нажать "Sync Suno" |
| Сканировать канал | Нажать "Scan Channel" |
| Верифицировать БД | Нажать "Verify DB" |
| Проверить дубликаты | Нажать "Check Duplicates" |
| Управлять метаданными | Раздел "Metadata Reviews" |
| Управлять платформами | Раздел "Cross-post Config" |
| Смотреть аналитику | Раздел "Analytics" |

### 28.4 FAQ

| Вопрос | Ответ |
|--------|-------|
| Почему видео долго грузится? | Видео хранятся на серверах Telegram. Если часто слушаете — загрузится в R2 для быстрого доступа. |
| Можно скачать песню? | Прямого скачивания нет, но можно открыть в Telegram. |
| Как предложить песню? | Написать в Telegram @shemaxpoetry. |
| Почему некоторые песни скрыты? | Они отмечены как невидимые (модерация, дубликаты, тесты). |
| Есть ли мобильное приложение? | Нет, но сайт адаптирован под мобильные браузеры. |

---

```
Безопасность + WCAG + SEO + Правовые
  │ (применимо ко всем этапам)
  ▼
Этап 0: Фундамент
  │
  ├──→ Этап 1: R2 Upload Queue
  │     └──→ Этап 6: Webhook + Дедупликация
  │
  ├──→ Этап 2: Suno метаданные (зависит от миграций)
  │
  ├──→ Этап 3: Поиск и фильтрация (зависит от миграций)
  │
  ├──→ Этап 4: Podcast-флоу (зависит от миграции 007)
  │
  ├──→ Этап 5: Внешние ссылки (зависит от миграции 008)
  │
  ├──→ Этап 7: Кросс-постинг (зависит от миграции 010 + регистрации)
  │     └──→ Этап 8: Аналитика (зависит от кросс-постинга)
  │
  └──→ Фронтенд (обновляется по мере готовности API)
       + CI/CD + Мониторинг + Документация (параллельно)
```

## Приложение A: Диаграмма зависимостей этапов

(см. выше — встроенная диаграмма в кодовом блоке)

---

## 29. Источники и нормативные документы

### 29.1 Нормативно-правовые акты РФ

| № | Документ | Описание | Применимость к проекту |
|---|----------|----------|------------------------|
| 1 | **152-ФЗ** «О персональных данных» от 27.07.2006 (ред. 2025) | Регулирует сбор, обработку, хранение и защиту персональных данных граждан РФ | ✅ Privacy policy учитывает. Уведомление Роскомнадзора не требуется (сайт не оператор ПДн в смысле ст. 22), но требуется согласие на обработку (ст. 9) |
| 2 | **149-ФЗ** «Об информации, информационных технологиях и о защите информации» от 27.07.2006 (ред. 2025) | Базовый закон: определение сайта, информации, ограничение доступа, распространение, ответственность | ✅ Необходимо: маркировка информации (если реклама), соблюдение ст. 10.2 (организатор распространения информации — не требуется для личного проекта), ст. 15.7 (авторские права) |
| 3 | **ГК РФ, Часть 4** (ст. 1225–1551) — «Права на результаты интеллектуальной деятельности» | Авторское право, смежные права, товарные знаки | ✅ Песни Shemax — объект авторского права (ст. 1259). Все права принадлежат автору |
| 4 | **ГК РФ, ст. 152.1** — Охрана изображения гражданина | Запрет на использование изображения без согласия | ⚠️ Если на обложках песен есть фото людей — требуется согласие |
| 5 | **Закон РФ № 2300-1** «О защите прав потребителей» от 07.02.1992 | Права пользователей как потребителей цифровых услуг | ✅ ToS учитывает. Сервис бесплатный — ответственность ограничена |
| 6 | **КоАП РФ, ст. 13.11** — Нарушение законодательства о персональных данных | Штрафы за обработку ПДн без согласия, несоответствие политики | ⚠️ Необходимо: проверить соответствие политики конфиденциальности требованиям Роскомнадзора |
| 7 | **187-ФЗ** «О безопасности КИИ» от 26.07.2017 | Защита критической информационной инфраструктуры | ❌ Не применимо — проект не является объектом КИИ |
| 8 | **Указ Президента № 889** от 15.10.2015 — о национальном сегменте интернета | Суверенный интернет, устойчивость сети | ❌ Не применимо к проекту на Cloudflare |

### 29.2 Стандарты разработки ПО (ГОСТ)

| № | Стандарт | Описание | Соответствие в проекте |
|---|----------|----------|------------------------|
| 1 | **ГОСТ 34.602-89** «Техническое задание на создание автоматизированной системы» | Базовая структура ТЗ: 8 разделов (общие сведения, назначение, требования, стадии, порядок контроля...) | ✅ Частично — данный план соответствует духу стандарта, но не всем разделам |
| 2 | **ГОСТ 34.601-90** «Стадии создания автоматизированных систем» | Формирование требований, концепция, ТЗ, эскизный проект, техпроект, рабочая документация, ввод в действие | ✅ Этапы 0–8 соответствуют стадиям «разработка» и «внедрение» |
| 3 | **ГОСТ Р ИСО/МЭК 12207-2010** (ISO/IEC 12207) «Процессы жизненного цикла программных средств» | 17 процессов: приобретение, поставка, разработка, эксплуатация, сопровождение | ❌ Не формализован. Для личного проекта избыточен |
| 4 | **ГОСТ 2.105-2019** «ЕСКД. Общие требования к текстовым документам» | Оформление документов (шрифты, нумерация, таблицы, ссылки) | ✅ Частично — нумерация разделов, таблицы, оформление соблюдены |
| 5 | **ГОСТ Р 51583-2014** «Защита информации. Порядок создания АС в защищённом исполнении» | Требования к защите информации на этапах создания АС | ✅ Частично — раздел 1.5 (Безопасность) учитывает базовые меры |
| 6 | **ГОСТ Р ИСО 9001-2015** «Системы менеджмента качества» | Процессный подход, постоянное улучшение | ❌ Не применимо к личному проекту |
| 7 | **ГОСТ Р 59792-2021** «Комплекс стандартов на автоматизированные системы» | Общие положения по созданию, эксплуатации, модернизации АС | ✅ Частично — терминология и подходы учтены |

### 29.3 Требования Роскомнадзора и локализация данных

| № | Требование | Суть | Применимость |
|---|------------|------|--------------|
| 1 | **Приказ Роскомнадзора № 378** (с изм. 2023) | Утверждение перечня мер по обеспечению безопасности ПДн | ⚠️ Если сайт собирает ПДн — требуется защита |
| 2 | **Постановление Правительства № 1119** от 01.11.2012 | Требования к защите ПДн в информационных системах | ⚠️ Определение уровня защищённости ПДн |
| 3 | **ФЗ № 242-ФЗ** от 21.07.2014 (о локализации ПДн) | Персональные данные граждан РФ должны обрабатываться на серверах в РФ | ❌ Cloudflare Workers — глобальная сеть. ПДн (IP, user-agent) не хранятся намеренно, только в логах Cloudflare за пределами РФ |

### 29.4 Стандарты доступности

| № | Стандарт | Описание | Применимость |
|---|----------|----------|--------------|
| 1 | **ГОСТ Р 52872-2019** «Интернет-ресурсы. Требования доступности для инвалидов по зрению» | Российский аналог WCAG 2.0 | ✅ Учтено в разделе 20 (WCAG AA) |
| 2 | **WCAG 2.1** (W3C Recommendation) | Международный стандарт доступности веб-контента | ✅ Цель — Level AA (раздел 20) |
| 3 | **ГОСТ Р 59820-2021** «Доступность интернет-ресурсов для инвалидов по зрению. Технические требования» | Дополнительные требования к UI | ✅ Частично |

### 29.5 Международные стандарты

| № | Стандарт | Описание | Применимость |
|---|----------|----------|--------------|
| 1 | **ISO 9241-11** — эргономика взаимодействия человек-компьютер | Usability, эффективность, удовлетворённость | ✅ Учтено в дизайне плеера |
| 2 | **ISO/IEC 25010 (SQuaRE)** — модель качества ПО | Функциональность, надёжность, безопасность, сопровождаемость | ✅ Частично — учтено в разделах 18, 23, 25 |
| 3 | **IEEE 830-1998** — Recommended Practice for Software Requirements Specifications | Структура SRS: functional, non-functional, interfaces, constraints | ✅ Частично — структура плана пересекается со спецификацией |

### 29.6 Облачная инфраструктура и юрисдикция

| Аспект | Ситуация | Комментарий |
|--------|----------|-------------|
| Хостинг за пределами РФ | Cloudflare Workers — глобальная edge-сеть | Данные не хранятся на территории РФ (кроме кэша CDN) |
| Локализация ПДн (242-ФЗ) | IP-адреса и user-agent логируются Cloudflare | Формально — обработка ПДн за пределами РФ. Для личного некоммерческого сайта риск минимален |
| Реестр ОЗПО (Постановление № 1236) | Cloudflare — иностранное ПО | Не применимо — проект не госзакупка |
| Блокировки (149-ФЗ, ст. 15.1-15.9) | Cloudflare может быть заблокирован на территории РФ | Работоспособность сайта в РФ не гарантируется. Резерв — перенос на российский хостинг |

### 29.7 Рекомендации по соблюдению

| № | Рекомендация | Статус |
|---|--------------|--------|
| 1 | Добавить форму согласия на обработку ПДн (checkbox) при первой загрузке | ❌ Не реализовано |
| 2 | Разместить Политику конфиденциальности по адресу /privacy | ✅ Реализовано |
| 3 | Разместить Пользовательское соглашение по адресу /terms | ❌ Не реализовано |
| 4 | Разместить информацию об авторских правах / DMCA по адресу /dmca | ❌ Не реализовано |
| 5 | Проверить, что на всех страницах есть ссылки на /privacy и /terms | ✅ Частично (только /privacy) |
| 6 | Добавить мета-теги для поисковых систем | ✅ Частично (раздел 21) |
| 7 | Проверить доступность через Lighthouse / axe-core (WCAG) | ❌ Не выполнено |
| 8 | Обеспечить хранение логов не более 3 дней (149-ФЗ, ст. 16) | ✅ Workers Logs retention — 3 дня по умолчанию |
| 9 | Проверить соответствие Privacy Policy требованиям 152-ФЗ (ст. 10, 22) | ⚠️ Требуется аудит юристом |

### 29.8 Источники (ссылки)

| Документ | Ссылка |
|----------|--------|
| 152-ФЗ «О персональных данных» | https://www.consultant.ru/document/cons_doc_LAW_61801/ |
| 149-ФЗ «Об информации...» | https://www.consultant.ru/document/cons_doc_LAW_61798/ |
| ГК РФ, Часть 4 (авторское право) | https://www.consultant.ru/document/cons_doc_LAW_64629/ |
| ГОСТ 34.602-89 | https://protect.gost.ru/document.aspx?control=7&id=201154 |
| ГОСТ Р ИСО/МЭК 12207-2010 | https://protect.gost.ru/document.aspx?control=7&id=179144 |
| WCAG 2.1 (русский перевод) | https://www.w3.org/Translations/WCAG21-ru/ |
| WCAG 2.2 (английский) | https://www.w3.org/TR/WCAG22/ |
| Cloudflare Privacy Policy | https://www.cloudflare.com/privacypolicy/ |
| Cloudflare DPA | https://www.cloudflare.com/cloudflare-customer-dpa/ |
| Роскомнадзор — Персональные данные | https://rkn.gov.ru/personal-data/ |

---

## Приложение B: Ключевые файлы проекта

| Файл | Назначение |
|------|------------|
| `src/worker.js` | Основной Worker (fetch, scheduled, queue) |
| `src/db.js` | Функции работы с D1 |
| `src/services.js` | Telegram API + getFile с KV кэшем |
| `src/utils.js` | Утилиты: safeJSON, cors, corsRestricted, secureHeaders, sanitizeError, rateLimit, htmlResponse, sunoFetch, parseMsgFull |
| `wrangler.jsonc` | Конфигурация Cloudflare Worker |
| `deploy.mjs` | Скрипт деплоя через API |
| `migrations/001-010.sql` | Миграции D1 |
| `public/js/app.js` | Фронтенд плеера |
| `public/js/admin.js` | Фронтенд админки |
| `public/js/i18n.js` | Интернационализация (ключ privacy) |
| `public/admin/index.html` | Страница админки |
| `public/index.html` | SPA плеер |
| `analysis/technical-specification-v2.md` | Техническое описание v2 |
| `analysis/crossposting-design.md` | Дизайн кросс-постинга и аналитики |
| `shemaxplan.md` | Этот файл |
| `scripts/backup-kv.sh` | Бэкап KV перед деплоем |
| `scripts/restore-kv.sh` | Восстановление KV из бэкапа |
| `.github/workflows/ci.yml` | CI/CD Pipeline |
| `.editorconfig` | Стандарты форматирования |
| `.prettierrc` | Настройки Prettier |
| `.eslintrc.json` | Настройки ESLint |

---

*Конец документа. Версия 2.0 — 28 июня 2026.*
