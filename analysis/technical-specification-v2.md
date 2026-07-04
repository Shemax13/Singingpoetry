# Technical Specification v2 — ShemaxPoetry

> Обновлённый план рефакторинга на основе уточнений: две таблицы, Suno как источник метаданных, R2 для постоянного хранения, два названия (Telegram/Suno), подкасты, внешние ресурсы, free tier Cloudflare.

---

## 1. Архитектура

```
Telegram API → Webhook → Worker
  ├── D1: INSERT message + UPSERT song (быстро, <10ms CPU)
  ├── Queue (shemax-uploads): { action, songId, tgFileId }
  └── Suno URL в caption → opensuno.vercel.app → KV cache → D1

Queue Consumer (shemax-uploads)
  ├── fetch getFile URL из Telegram
  ├── stream → R2 bucket "shemaxpoetry"
  ├── D1: UPDATE r2_video_url / extra_audio.r2_key
  └── retry max 3, иначе лог ошибки

Cron (0 6 * * *) — метаданные
  ├── Выбрать песни без suno_audio_url или с updated_at > 24h
  ├── opensuno.vercel.app (с KV-кэшем 24ч)
  ├── Если данные изменились → D1 + флаг pending_review
  └── Если прокси не ответил → пропустить, оставить старые данные

Browser → Worker
  ├── /api/songs — D1 (с возможностью поиска)
  ├── /api/media/:id — R2 → Telegram getFile → Suno CDN (fallback chain)
  ├── /api/song/:id/podcasts — extra_audio
  ├── /api/songs/:id/links — внешние ссылки
  └── /* — KV (статический фронтенд)
```

---

## 2. Схема БД

### 2.1 Таблица songs (обновлённая)

| Поле | Тип | Назначение |
|------|-----|-----------|
| id | INTEGER PK AUTOINCREMENT | |
| title | TEXT | Из Telegram (приоритет по умолчанию) |
| suno_title | TEXT | Название из Suno (для ручного выбора в админке) |
| description | TEXT | Произвольное описание песни (заполняется в админке) |
| lyrics | TEXT | Текст песни |
| tg_video_url | TEXT | Telegram mp4 (временная ссылка) |
| tg_file_id | TEXT | Для getFile |
| suno_audio_url | TEXT | mp3 из Suno CDN (постоянная ссылка) |
| suno_cover_url | TEXT | Обложка с Suno CDN (постоянная ссылка) |
| suno_track_url | TEXT | Ссылка на страницу трека в Suno |
| cover_url | TEXT | Старая обложка из Telegram |
| r2_video_url | TEXT | mp4 в R2 (основной источник после миграции) |
| r2_migratable | INTEGER DEFAULT 1 | 0 — нельзя мигрировать в R2 (invalid file_id) |
| pending_review | INTEGER DEFAULT 0 | 1 — есть новые метаданные от Suno для ручной проверки |
| pending_metadata | TEXT | JSON с новыми данными от Suno: `{ title: {old, new}, cover_url: {...} }` |
| metadata_source | TEXT | suno / telegram / manual |
| visible | INTEGER DEFAULT 1 | |
| language | TEXT DEFAULT 'ru' | |
| order_index | INTEGER | Порядок сортировки |
| telegram_message_id | INTEGER | ID сообщения в Telegram |
| published_at | TEXT | ISO datetime |
| created_at | TEXT | |
| updated_at | TEXT | |

### 2.2 Таблица extra_audio (замена audio_breakdowns)

| Поле | Тип | Назначение |
|------|-----|-----------|
| id | INTEGER PK AUTOINCREMENT | |
| song_id | INTEGER NOT NULL REFERENCES songs(id) | FK — подкаст всегда привязан к песне |
| title | TEXT | Название подкаста |
| file_url | TEXT | Временная ссылка (Telegram URL) |
| r2_key | TEXT | Ключ в R2: `extra/{uuid}.m4a` |
| file_type | TEXT | podcast / bonus / interview |
| source | TEXT | telegram / admin-url / admin-upload |
| telegram_message_id | INTEGER | Если пришёл через Telegram |
| duration | INTEGER | Длительность в секундах |
| visible | INTEGER DEFAULT 1 | |
| published_at | TEXT | |
| created_at | TEXT | |
| updated_at | TEXT | |

### 2.3 Таблица external_link_types

| Поле | Тип | Назначение |
|------|-----|-----------|
| id | INTEGER PK AUTOINCREMENT | |
| name | TEXT UNIQUE | Instagram, TikTok, VK, YouTube... |
| icon | TEXT | emoji / icon class / SVG-путь |
| sort_order | INTEGER | Порядок отображения |
| created_at | TEXT | |

Pre-populated: Instagram (📷), TikTok (🎵), VK (💬). Через админку можно добавлять/удалять.

### 2.4 Таблица song_external_links

| Поле | Тип | Назначение |
|------|-----|-----------|
| id | INTEGER PK AUTOINCREMENT | |
| song_id | INTEGER NOT NULL REFERENCES songs(id) | FK |
| link_type_id | INTEGER NOT NULL REFERENCES external_link_types(id) | FK |
| url | TEXT | Полная ссылка (https://...) |
| description | TEXT | Короткое описание (опционально) |
| created_at | TEXT | |

### 2.5 Таблица metadata_reviews

| Поле | Тип | Назначение |
|------|-----|-----------|
| id | INTEGER PK AUTOINCREMENT | |
| song_id | INTEGER NOT NULL REFERENCES songs(id) | |
| field | TEXT | title / lyrics / cover_url |
| old_value | TEXT | |
| new_value | TEXT | |
| source | TEXT | suno |
| status | TEXT | pending / approved / rejected |
| created_at | TEXT | |

### 2.6 Таблицы без изменений

- `messages` — как есть (003_create_messages.sql)
- `admin_sessions` — как есть (001_create_tables.sql)

---

## 3. Workers Queue: асинхронная загрузка в R2

### Зачем

Webhook должен отвечать быстро (<10ms CPU на free плане). Скачивание mp4 через getFile и загрузка в R2 — тяжёлая операция. Выносим в очередь.

### Конфигурация wrangler.jsonc

```json
{
  "queues": [{
    "binding": "UPLOAD_QUEUE",
    "queue": "shemax-uploads"
  }],
  "r2_buckets": [{
    "binding": "MEDIA",
    "bucket_name": "shemaxpoetry"
  }]
}
```

### Consumer в worker.js

```javascript
async queue(batch, env) {
  for (const msg of batch.messages) {
    const { action, songId, tgFileId, extraAudioId } = msg.body;

    if (action === 'upload-mp4') {
      const fileUrl = await getTelegramFileUrl(tgFileId, env);
      if (!fileUrl) { msg.retry({ delaySeconds: 60 }); continue; }

      const response = await fetch(fileUrl);
      const r2Key = `songs/${songId}.mp4`;
      await env.MEDIA.put(r2Key, response.body);

      await env.DB.prepare(
        "UPDATE songs SET r2_video_url = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(r2Key, songId).run();
    }

    if (action === 'upload-extra') {
      // Аналогично для подкастов
    }
  }
}
```

### Free plan учёт

- Queues: 10k ops/day бесплатно (с Feb 2026)
- 1 песня/день = 1 queue msg + 1 consumer = 2 ops
- Backfill 250 песен = 500 ops (разово)
- Укладываемся с запасом

---

## 4. opensuno.vercel.app: KV-кэш + fallback

### Проблема

opensuno — публичный прокси, может умереть в любой момент. Rate limit: 20 запросов/мин.

### Алгоритм

```javascript
async function fetchSunoMetadata(trackUrl, env) {
  // 1. KV-кэш (24ч TTL)
  const cached = await env.STATIC.get(`suno:${trackUrl}`, 'json');
  if (cached && Date.now() - cached.ts < 86400000) return cached.data;

  // 2. opensuno
  try {
    const resp = await fetch(
      `https://opensuno.vercel.app/track?url=${encodeURIComponent(trackUrl)}`
    );
    if (!resp.ok) throw new Error(`opensuno ${resp.status}`);
    const data = await resp.json();
    await env.STATIC.put(`suno:${trackUrl}`, JSON.stringify({ data, ts: Date.now() }));
    return data;
  } catch (e) {
    // 3. Fallback — бессрочный кэш (если данные когда-то были)
    const fallback = await env.STATIC.get(`suno:${trackUrl}:fallback`, 'json');
    return fallback?.data || null;
  }
}
```

### gcui-art/suno-api (опционально)

Разворачивается отдельно (Vercel / Docker). В .env / secrets: `SUNO_API_URL`.
Cron использует его в дополнение к opensuno, не вместо.

---

## 5. Приоритет метаданных

### При создании песни (webhook)

1. Telegram post: `tg_video_url`, `tg_file_id`, caption → `title`
2. Suno URL в caption: запрос opensuno → `suno_title`, `suno_audio_url`, `suno_cover_url`, `lyrics`
3. Запись в songs: `title` из Telegram (или "Untitled"), `suno_title` если есть
4. `metadata_source = 'suno'` если Suno ответил, иначе `'telegram'`

### При ежедневном cron (0 6 * * *)

1. Выбрать песни с `updated_at > 24h` И без suno_audio_url
2. Для каждой: запросить opensuno
3. Если данные отличаются:
   - Обновить БД (`suno_title`, `suno_cover_url`, `lyrics`)
   - `pending_review = 1`
   - `pending_metadata = JSON diff`
   - Запись в `metadata_reviews`
4. Если opensuno не ответил → оставить существующие данные

### Admin review

- Индикатор "🟡 Pending review" для песен с `pending_review = 1`
- Показать diff (старое → новое)
- Apply: применить данные из `suno_*` полей, `pending_review = 0`
- Reject: отклонить, `pending_review = 0`

---

## 6. Медиа-флоу (R2 → Telegram → Suno)

### /api/media/:id

```
1. r2_video_url есть    → 302 redirect на R2 public URL
2. tg_file_id есть      → Telegram getFile → 302 redirect
3. tg_video_url есть    → 302 redirect (может быть протухший)
4. suno_audio_url есть  → 302 redirect (Suno CDN, постоянный)
5. ничего нет           → 404
```

### При webhook (получение mp4)

1. Сохранить `tg_video_url` / `tg_file_id` в D1 (синхронно)
2. Отправить в очередь `{ action: 'upload-mp4', songId, tgFileId }`
3. Ответ webhook — немедленно (не ждать загрузки)

### Backfill старых песен

Admin endpoint `POST /api/admin/migrate-to-r2`:
- Берёт пачку песен (limit=5), у которых есть `tg_file_id`, `r2_migratable=1`, нет `r2_video_url`
- Для каждой: отправляет в очередь
- Между пачками: `await sleep(2000)`
- Вызывать вручную из админки

---

## 7. Подкасты

### Telegram (основной путь)

- Webhook получает аудио (m4a/mp3) с `reply_to_message_id` = mp4 песни
- Создаётся запись в `extra_audio`:
  - `song_id` = найден по `reply_to_message_id` через messages
  - `file_url` = Telegram file URL (временный)
  - `source = 'telegram'`
  - `telegram_message_id`
- В очередь: `{ action: 'upload-extra', extraAudioId }`
- Consumer: fetch → R2 `extra/{uuid}.m4a` → update `r2_key`

### Admin (ручной ввод)

- `POST /api/admin/extra-audio`: song_id, title, file_url, source='admin-url'
- `POST /api/admin/extra-audio/upload`: multipart upload → R2, source='admin-upload'

### Фронтенд

- `togglePodcast()`:
  - Сохраняет `podcastReturnIndex` + `podcastReturnTime` (currentTime видео/аудио)
  - Fetch `/api/song/:id/podcasts` → список extra_audio
  - Если >1 — показать выбор (popup), иначе играть сразу
  - Показывает "✕" на кнопке подкаста
- По окончании подкаста: `audio.currentTime = podcastReturnTime; play()`
- Если пользователь переключил песню → `podcastReturnIndex` сбрасывается
- Если нажал ✕ → остановить подкаст, resume песни

---

## 8. Внешние ссылки

### API Endpoints

- `GET /api/songs` — добавляется computed column `external_link_count`
- `GET /api/songs/:id/links` — список внешних ссылок для песни:
  ```json
  [{ "id": 1, "type": "Instagram", "icon": "📷", "url": "https://...", "description": "..." }]
  ```
- Admin CRUD:
  - `GET/POST/PUT/DELETE /api/admin/external-link-types`
  - `GET/POST/DELETE /api/admin/songs/:id/external-links`

### Фронтенд

- Если у песни `external_link_count > 0` → маленькая иконка 🔗 поверх карточки песни (рядом с иконкой подкаста)
- По клику → popup со значками ресурсов (📷 🎵 💬 и т.д.)
- Клик по значку → `window.open(url, '_blank', 'noopener')`

### Админка

- Раздел "External Links" в карточке песни: добавить/удалить ссылку
- Раздел "Link Types": CRUD (название, иконка, порядок)

---

## 9. Заголовок Shemaxpoetry как ссылка на Telegram

В `index.html` / `app.js`:
- Текст "Shemaxpoetry" в шапке плеера заворачивается в `<a>`
- `href="https://t.me/shemaxpoetry" target="_blank" rel="noopener noreferrer"`
- Визуальное оформление не меняется (те же стили, цвет, шрифт)

---

## 10. Поиск и фильтрация

### GET /api/songs

Новые query-параметры:

```http
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

Индекс:
```sql
CREATE INDEX IF NOT EXISTS idx_songs_visible_title ON songs(visible, title);
```

---

## 11. Дедупликация webhook

```javascript
const existing = await env.DB.prepare(
  "SELECT id FROM messages WHERE tg_msg_id = ? AND chat_id = ?"
).bind(msg.tg_msg_id, msg.chat_id).first();

if (existing) {
  // Обновить существующее, не создавать дубликат
  log('warn', 'duplicate_webhook', { tg_msg_id: msg.tg_msg_id });
  return new Response('OK (duplicate)');
}
```

---

## 12. R2 cleanup при удалении

```javascript
async function deleteSong(id, env) {
  const song = await env.DB.prepare("SELECT r2_video_url FROM songs WHERE id=?").bind(id).first();
  if (song?.r2_video_url) {
    const key = `songs/${id}.mp4`;
    await env.MEDIA.delete(key);
  }

  const extras = await env.DB.prepare("SELECT r2_key FROM extra_audio WHERE song_id=?").bind(id).all();
  for (const ext of extras.results) {
    if (ext.r2_key) await env.MEDIA.delete(ext.r2_key);
  }

  await env.DB.prepare("DELETE FROM extra_audio WHERE song_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM songs WHERE id=?").bind(id).run();
}
```

---

## 13. Мониторинг и логи

```javascript
function log(level, event, data = {}) {
  const entry = { event, ...data, ts: new Date().toISOString() };
  console[level](JSON.stringify(entry));
}
```

### Ключевые события

| Событие | Уровень | Когда |
|---------|---------|-------|
| `webhook_received` | info | Каждое обновление от Telegram |
| `duplicate_webhook` | warn | Сообщение уже обработано |
| `r2_upload_start` | info | Начало загрузки в R2 |
| `r2_upload_success` | info | Успешная загрузка |
| `r2_upload_failed` | error | Ошибка загрузки |
| `suno_fetch_success` | info | opensuno ответил |
| `suno_fetch_failed` | error | opensuno не ответил |
| `metadata_updated` | info | Cron обновил метаданные |
| `media_404` | warn | Нет ни R2, ни Telegram, ни Suno |

Free plan: Workers Logs бесплатно, 7 дней хранения, до 5 млрд логов/день.

---

## 14. Учёт free tier Cloudflare

| Лимит | Значение | Как укладываемся |
|-------|----------|------------------|
| CPU time | 10ms/request | Webhook: только D1 + queue msg. R2 upload — в очередь |
| Subrequests (внешние) | 50/request | Делаем <10 |
| Requests/day | 100,000 | ~1k-5k текущих — с запасом |
| Память | 128 MB | Влезаем |
| Cron triggers | 5/account | 1 (metadata sync) |
| R2 storage | 10GB | ~250-500 mp4. При превышении — новые на R2, старые через Telegram |
| Queue ops | 10k/day | 2-4 ops/день в норме |
| KV reads/writes | 100k/1k per day | Влезаем |

### Если R2 превышает 10GB

Приоритет R2: сначала самое новое (последние N песен). Старые — fallback на Telegram getFile.

```javascript
// /api/media/:id
if (song.r2_video_url) return redirect(song.r2_video_url);
// иначе Telegram getFile как сейчас
```

---

## 15. Дорожная карта (этапы)

### Этап 0: Фундамент

- [ ] Создать R2 bucket `shemaxpoetry`
- [ ] Создать Queue `shemax-uploads`
- [ ] Обновить `wrangler.jsonc` (R2 + Queue биндинги)
- [ ] Настроить `limits.cpu_ms` и `limits.subrequests` при необходимости
- [ ] Миграция 006: добавить поля в `songs` (`r2_video_url`, `r2_migratable`, `pending_review`, `pending_metadata`, `metadata_source`, `suno_title`, `description`)
- [ ] Миграция 007: создать `extra_audio`, перенести данные из `audio_breakdowns`, удалить `audio_breakdowns`
- [ ] Миграция 008: создать `external_link_types` + `song_external_links`
- [ ] Миграция 009: создать `metadata_reviews`
- [ ] Добавить индексы: `idx_songs_visible_title`, индексы на FK

### Этап 1: R2 Upload Queue

- [ ] Worker: отправить в очередь при webhook (mp4 + extra_audio)
- [ ] Worker: consumer очереди (fetch → stream → R2 → D1)
- [ ] Worker: admin endpoint `POST /api/admin/migrate-to-r2` (backfill)
- [ ] Worker: обновить `/api/media/:id` — R2 → Telegram → Suno
- [ ] Worker: R2 cleanup при DELETE

### Этап 2: Метаданные

- [ ] Worker: KV-кэш для opensuno (24h TTL)
- [ ] Worker: cron с обновлённой логикой (diff → pending_review)
- [ ] Worker: admin endpoints для metadata_reviews
- [ ] Фронтенд админки: UI для pending review (diff / apply / reject)

### Этап 3: Поиск и фильтрация

- [ ] Worker: `GET /api/songs?search=&language=`
- [ ] D1: индекс idx_songs_visible_title
- [ ] Фронтенд: поле поиска, фильтр языка

### Этап 4: Podcast-флоу

- [ ] Worker: CRUD для `extra_audio` (admin)
- [ ] Worker: обновить `/api/song/:id/podcasts`
- [ ] Worker: queue-загрузка extra_audio в R2
- [ ] Фронтенд: resume position, выбор подкаста из списка

### Этап 5: Внешние ссылки

- [ ] Worker: CRUD для `external_link_types` (admin)
- [ ] Worker: CRUD для `song_external_links` (admin)
- [ ] Worker: `/api/songs/:id/links` (public)
- [ ] Фронтенд: иконка 🔗 + popup с ресурсами
- [ ] Фронтенд: заголовок-ссылка на t.me/shemaxpoetry

### Этап 6: Webhook + Дедупликация

- [ ] Worker: проверка `tg_msg_id + chat_id` перед вставкой
- [ ] Worker: `log()` во все обработчики
- [ ] Настроить Workers Logs в Dashboard

---

## 16. Миграции D1

### 006_add_song_fields.sql

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

### 007_create_extra_audio.sql

```sql
CREATE TABLE IF NOT EXISTS extra_audio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  title TEXT,
  file_url TEXT,
  r2_key TEXT,
  file_type TEXT DEFAULT 'podcast',
  source TEXT DEFAULT 'telegram',
  telegram_message_id INTEGER,
  duration INTEGER,
  visible INTEGER DEFAULT 1,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_extra_audio_song_id ON extra_audio(song_id);
CREATE INDEX IF NOT EXISTS idx_extra_audio_visible ON extra_audio(visible);

-- Перенос данных из audio_breakdowns
INSERT INTO extra_audio (song_id, title, file_url, file_type, duration, visible)
SELECT song_id, title, file_url, 'podcast', duration, visible FROM audio_breakdowns;

DROP TABLE audio_breakdowns;
```

### 008_create_external_links.sql

```sql
CREATE TABLE IF NOT EXISTS external_link_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '🔗',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS song_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  link_type_id INTEGER NOT NULL REFERENCES external_link_types(id),
  url TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_song_external_links_song_id ON song_external_links(song_id);

-- Pre-populated types
INSERT INTO external_link_types (name, icon, sort_order) VALUES
  ('Instagram', '📷', 1),
  ('TikTok', '🎵', 2),
  ('VK', '💬', 3);
```

### 009_create_metadata_reviews.sql

```sql
CREATE TABLE IF NOT EXISTS metadata_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT DEFAULT 'suno',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metadata_reviews_song_id ON metadata_reviews(song_id);
CREATE INDEX IF NOT EXISTS idx_metadata_reviews_status ON metadata_reviews(status);
```

---

## 17. Новые API endpoints

### Public

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/songs?search=&language=` | Список песен с поиском и фильтром |
| GET | `/api/songs/:id/links` | Внешние ссылки для песни |

### Admin

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/admin/migrate-to-r2` | Backfill: отправить в очередь пачку песен |
| GET | `/api/admin/metadata-reviews` | Список pending review |
| POST | `/api/admin/metadata-reviews/:id/approve` | Принять изменение |
| POST | `/api/admin/metadata-reviews/:id/reject` | Отклонить изменение |
| GET/POST | `/api/admin/external-link-types` | CRUD типов ресурсов |
| PUT/DELETE | `/api/admin/external-link-types/:id` | CRUD типов ресурсов |
| GET/POST | `/api/admin/songs/:id/external-links` | CRUD ссылок песни |
| DELETE | `/api/admin/songs/:id/external-links/:linkId` | Удалить ссылку |
| GET/POST | `/api/admin/extra-audio` | CRUD подкастов |
| POST | `/api/admin/extra-audio/upload` | Upload подкаста |
| DELETE | `/api/admin/extra-audio/:id` | Удалить подкаст |

### Queue Consumer

| Обработчик | Назначение |
|------------|------------|
| `queue(batch, env)` | Upload mp4/extra в R2 |

### Cron

| Расписание | Обработчик | Назначение |
|------------|------------|------------|
| `0 6 * * *` | `scheduled(event, env, ctx)` | Синхронизация метаданных Suno |

---

## 18. Обновление wrangler.jsonc

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
  "name": "poetry",
  "main": "src/worker.js",
  "compatibility_date": "2026-06-17",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "SHEMAX_DB",
      "database_id": "c139e4fb-afee-4752-978e-f323bbec4aa7"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "STATIC",
      "id": "1994525bead042229fed7f2bd41d2f3a"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA",
      "bucket_name": "shemaxpoetry"
    }
  ],
  "queues": [
    {
      "binding": "UPLOAD_QUEUE",
      "queue": "shemax-uploads"
    }
  ],
  "triggers": {
    "crons": ["0 6 * * *"]
  }
}
```

---

## 19. Workers Logs: ключевые запросы

После деплоя можно смотреть логи через Cloudflare Dashboard или `wrangler tail`:

```bash
# Логи загрузок в R2
wrangler tail --format json | grep r2_upload

# Ошибки
wrangler tail --format json | grep error

# Webhook активность
wrangler tail --format json | grep webhook
```

В Dashboard: Workers & Pages → poetry → Logs — фильтр по `event` полю.

---

*Конец документа. Версия 2.0 — 27 июня 2026.*
