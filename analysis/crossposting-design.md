# Cross-Posting & Analytics Module — Design Document

> Версия 1.0 — 28 июня 2026
> Основание: technical-specification-v2.md, уточнения пользователя от 28.06.2026

---

## 1. Цели модуля

1. **Cross-posting**: после публикации песни в Telegram автоматически размещать её на VK, YouTube, Threads, Rutube (и других платформах по мере добавления).
2. **Analytics**: ежедневный сбор статистики (просмотры, лайки, комментарии, репосты) со всех платформ, расчёт рейтинга песен.
3. **Trimming**: для платформ с ограничением длины видео — автоматическая обрезка через FFmpeg.wasm.

---

## 2. Архитектура

```
Cron (08:00 UTC+3 ежедневно)
  → Worker: выбор песен за последние 24ч без cross_post_status
  → Для каждой песни × каждая enabled-платформа:
     → INSERT cross_post_status (pending)
     → Отправка в Queue: { action: "crosspost", songId, platform }

Queue consumer (shemax-uploads):
  → В зависимости от platform:
     → YouTube:  OAuth refresh → resumable upload → set privacy
     → VK:       video.save → upload URL → PUT video → wall.post
     → Threads:  OAuth refresh → create media container → publish
     → Rutube:   API upload → publish

  Если видео превышает лимит платформы:
     → FFmpeg.wasm: R2 → trim → upload trimmed version → "(Abridged)" in description

  → UPDATE cross_post_status (published / failed)

Cron (06:00 UTC+3 ежедневно) — сбор аналитики:
  → Для каждой платформы:
     → Fetch platform API (статистика по каждому cross_post_status)
     → INSERT analytics_snapshots
  → Пересчёт songs.rating
```

### 2.1 Почему Queue, а не fetch handler

- Загрузка 20-30MB видео на внешнюю платформу требует >10ms CPU (fetch handler limit)
- Queue consumer: до 15 минут на batch, 128MB памяти, нет жёсткого CPU лимита
- Free tier: 10k ops/day, при 1 песне × 4 платформы = 8 ops/day (отправка + consumer)

### 2.2 FFmpeg.wasm для обрезки

- Библиотека `@ffmpeg/ffmpeg` v0.12+ компилируется в WASM
- Загружается в Queue consumer единоразово (~30MB)
- Процесс: R2.stream → ffmpeg.trim(durationSec) → Uint8Array → fetch на платформу
- Память: WASM (30MB) + входное видео (30MB) + выходное (2MB для обрезанного) ≈ 62MB — влезает в 128MB
- Если WASM не сработает — fallback: пропуск платформы с пометкой "abridged"

---

## 3. Platform-specific research

### 3.1 YouTube

| Параметр | Значение |
|----------|----------|
| API | YouTube Data API v3, `videos.insert` |
| Auth | OAuth 2.0, scope `youtube.upload`, refresh token (1yr) |
| Upload | Resumable upload (multipart), до 256GB |
| Лимит длины | Неограничен (для верифицированных аккаунтов) |
| Лимит размера | 256GB |
| Quota | 100 uploads/day (1 unit/upload) |
| Доп. шаги | После upload — `videos.update` для статуса `public/unlisted` |
| Наши стихи | ✅ Без ограничений |
| Наши подкасты | ✅ Без ограничений |

**Регистрация**:
1. Создать проект в https://console.cloud.google.com
2. Включить YouTube Data API v3
3. OAuth consent screen (External, тестовый режим)
4. Создать OAuth 2.0 Client ID (Desktop application)
5. Авторизовать однократно вручную → получить auth code → обменять на refresh token
6. Refresh token хранить в Worker secret: `CP_YOUTUBE_REFRESH`

### 3.2 VK

| Параметр | Значение |
|----------|----------|
| API | `video.save` → upload → `video.edit` + `wall.post` |
| Auth | Access token (Implicit Flow), права `video, wall, groups` |
| Upload | Server-to-server: `video.save` → upload_url → PUT binary |
| Лимит длины | Нет жёсткого лимита (тестировано: часы) |
| Лимит размера | 1024MB |
| Доп. шаги | После upload — `wall.post` с attachment `video{owner_id}_{video_id}` |
| Наши стихи | ✅ Без ограничений |
| Наши подкасты | ✅ Без ограничений |

**Регистрация**:
1. Создать Standalone-приложение на https://vk.com/dev
2. Получить access token через Implicit Flow: `https://oauth.vk.com/authorize?client_id={APP_ID}&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=video,wall,offline&response_type=token`
3. Токен бессрочный (offline). Хранить в Worker secret: `CP_VK_ACCESS_TOKEN`
4. Дополнительно: `CP_VK_GROUP_ID` (ID сообщества, если постинг от группы)

### 3.3 Threads

| Параметр | Значение |
|----------|----------|
| API | Instagram Graph API / Threads API (`/me/threads`, `/me/threads_publish`) |
| Auth | OAuth 2.0, Facebook Page token, scope `threads_manage, threads_publish` |
| Upload | Создать media container → publish |
| Лимит длины | 5 минут |
| Лимит размера | 100MB |
| Доп. шаги | Видео >5 мин → FFmpeg.wasm обрезка до 5:00 + "(Abridged)" |
| Наши стихи | ✅ (10-30с, влезает) |
| Наши подкасты | ❌ >5 мин → обрезка |

**Регистрация**:
1. Создать Instagram Professional аккаунт
2. Создать/привязать Threads аккаунт
3. Создать приложение в https://developers.facebook.com
4. Добавить продукт "Instagram Graph API" → "Threads"
5. Получить Page access token через Facebook Login
6. Обменять на долгоживущий токен (60 дней)
7. Хранить Refresh token в Worker secret: `CP_THREADS_REFRESH`

### 3.4 Rutube

| Параметр | Значение |
|----------|----------|
| API | Rutube API (непубличный, по партнёрскому договору) |
| Auth | API key или Bearer token |
| Upload | Многошаговая загрузка (инициализация → часть → финализация) |
| Лимит длины | До 24ч для верифицированных |
| Лимит размера | 20GB |
| Доп. шаги | Требуется партнёрская регистрация |
| Наши стихи | ✅ (после получения доступа) |
| Наши подкасты | ✅ (после получения доступа) |

**Регистрация**:
1. Заполнить заявку на https://rutube.ru/promo/api/ (партнёрская программа)
2. После получения API key — хранить в Worker secret: `CP_RUTUBE_API_KEY`
3. URL эндпоинтов уточнить в документации Rutube (обычно `https://api.rutube.ru/...`)

### 3.5 Telegram (уже есть)

Telegram остаётся первичной платформой. В рамках кросс-постинга:
- Не нужно загружать — песня уже опубликована в канале
- При создании cross_post_status для Telegram: статус "published" с URL = `https://t.me/shemaxpoetry/{msg_id}`
- Аналитика Telegram: переходы по ссылкам можно отслеживать через Telegram API (пока не реализуем)

---

## 4. Схема БД

### 4.1 cross_post_config (migration 010)

```sql
CREATE TABLE IF NOT EXISTS cross_post_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT UNIQUE NOT NULL,           -- 'youtube', 'vk', 'threads', 'rutube', 'telegram'
  enabled INTEGER DEFAULT 0,               -- 0=disabled, 1=enabled
  display_name TEXT,                        -- 'YouTube', 'VK', etc.
  icon TEXT DEFAULT '🔗',                   -- emoji/icon
  max_video_duration_sec INTEGER,           -- лимит платформы (NULL = нет лимита)
  max_video_size_bytes INTEGER,             -- лимит платформы
  cooldown_minutes INTEGER DEFAULT 0,       -- минимальный интервал между постами (0=нет)
  config_json TEXT,                         -- доп. настройки (JSON): channel_id, default_tags...
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Pre-populated rows:

| platform | display_name | icon | max_video_duration_sec | max_video_size_bytes | cooldown_minutes |
|----------|-------------|------|----------------------|---------------------|:-:|
| telegram | Telegram | ✈️ | NULL | 52428800 (50MB) | 0 |
| youtube | YouTube | ▶️ | NULL | 274877906944 (256GB) | 0 |
| vk | VK | 💬 | NULL | 1073741824 (1024MB) | 0 |
| threads | Threads | 🧵 | 300 (5min) | 104857600 (100MB) | 0 |
| rutube | Rutube | 📺 | NULL | 21474836480 (20GB) | 0 |

### 4.2 cross_post_status (migration 010)

```sql
CREATE TABLE IF NOT EXISTS cross_post_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  platform TEXT NOT NULL,                   -- 'youtube', 'vk', 'threads', 'rutube', 'telegram'
  status TEXT DEFAULT 'pending',            -- pending / uploading / published / failed / skipped
  platform_post_id TEXT,                    -- ID видео на платформе
  platform_url TEXT,                        -- Ссылка на видео на платформе
  error_message TEXT,                       -- Причина failed / skipped
  abridged INTEGER DEFAULT 0,               -- 1 = обрезанная версия
  retry_count INTEGER DEFAULT 0,            -- количество попыток (max 3)
  published_at TEXT,                        -- когда опубликовано
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(song_id, platform)                 -- один пост на платформу на песню
);

CREATE INDEX IF NOT EXISTS idx_cps_song_id ON cross_post_status(song_id);
CREATE INDEX IF NOT EXISTS idx_cps_platform ON cross_post_status(platform);
CREATE INDEX IF NOT EXISTS idx_cps_status ON cross_post_status(status);
```

### 4.3 analytics_snapshots (migration 010)

```sql
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  platform TEXT NOT NULL,
  platform_post_id TEXT,
  snapshot_date TEXT NOT NULL,              -- YYYY-MM-DD
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  additional_data TEXT,                     -- JSON с платформо-специфичными метриками
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(song_id, platform, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_as_song_date ON analytics_snapshots(song_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_as_platform ON analytics_snapshots(platform);
```

### 4.4 songs — новое поле rating (migration 010)

```sql
ALTER TABLE songs ADD COLUMN rating REAL DEFAULT 0;
ALTER TABLE songs ADD COLUMN rating_updated_at TEXT;
```

### 4.5 ER-связи

```
songs (id) ──< cross_post_status (song_id)
songs (id) ──< analytics_snapshots (song_id)
cross_post_config (platform) ── используется в cross_post_status (platform)
```

---

## 5. API Endpoints

### 5.1 Public

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/songs/:id/links` | Уже есть из spec-v2 (внешние ссылки + кросс-пост ссылки) |

### 5.2 Admin

| Метод | Путь | Описание |
|-------|------|----------|
| GET/POST | `/api/admin/crosspost-config` | CRUD настроек платформ |
| PUT/DELETE | `/api/admin/crosspost-config/:id` | CRUD настроек платформ |
| GET | `/api/admin/crosspost-status` | Список статусов (фильтр: song_id, platform, status) |
| GET | `/api/admin/crosspost-status/:id` | Статус конкретного кросс-поста |
| POST | `/api/admin/crosspost/publish` | Ручной триггер кросс-поста: `{ song_id, platform, force: true }` |
| POST | `/api/admin/crosspost/retry` | Повторная попытка: `{ id }` |
| GET | `/api/admin/analytics/snapshots` | Снимки аналитики (фильтр: song_id, platform, date_from, date_to) |
| GET | `/api/admin/analytics/rating` | Рейтинг песен (sorted by rating DESC) |

### 5.3 Queue Consumer

```
queue(batch, env) {
  for (msg of batch.messages) {
    switch (msg.body.action) {
      case "crosspost":  → crosspostToPlatform(msg.body)
      case "analytics":   → collectPlatformAnalytics(msg.body)
    }
  }
}
```

### 5.4 Cron

| Расписание | Обработчик | Назначение |
|------------|------------|------------|
| `0 8 * * *` | `scheduled_crosspost` | Кросс-постинг ожидающих песен |
| `0 6 * * *` | `scheduled_analytics` | Сбор аналитики + пересчёт рейтинга |

---

## 6. Flow детально

### 6.1 Cross-posting flow

```
08:00 UTC+3 — Cron trigger
  → SELECT songs WHERE published_at > DATE('now', '-1 day')
     AND id NOT IN (SELECT song_id FROM cross_post_status WHERE status='published')
  → Для каждой песни:
     → SELECT * FROM cross_post_config WHERE enabled=1 AND platform!='telegram'
     → Для каждой платформы:
        → Проверить cooldown (если последний пост на эту платформу был < X минут назад — пропустить)
        → INSERT cross_post_status (status='pending')
        → Отправить в очередь: { action: "crosspost", songId, platform, crossPostId }

Queue consumer (shemax-uploads):
  → crossPostId = msg.body.crossPostId
  → UPDATE cross_post_status SET status='uploading' WHERE id=crossPostId
  → Получить песню из D1
  → Получить видео из R2 (ключ: songs/{songId}.mp4) или Telegram getFile
  → Проверить длительность видео против max_video_duration_sec платформы:
     → Если превышает:
        → Запустить FFmpeg.wasm: trim до max_video_duration_sec
        → Сохранить обрезанную версию в R2: songs/{songId}-trimmed.mp4
        → При публикации: добавить "(Abridged)" в title/description
        → cross_post_status.abridged = 1
  → Платформо-специфичная загрузка:
     === YouTube ===
        → OAuth: refresh token → access token
        → Resumable upload: POST upload_url → PUT video data
        → UPDATE video privacy (public/unlisted)
        → save platform_post_id, platform_url
     === VK ===
        → video.save → upload_url
        → PUT binary to upload_url
        → video.edit (title, description)
        → wall.post с attachment video{owner_id}_{video_id}
        → save platform_post_id, platform_url
     === Threads ===
        → OAuth: refresh token → access token
        → POST /me/threads (media_container, media_type=VIDEO, video_url from R2)
        → POST /me/threads_publish (creation_id)
        → save platform_post_id, platform_url
     === Rutube ===
        → API key auth
        → Инициализация загрузки → загрузка частями → финализация → публикация
        → save platform_post_id, platform_url
  → UPDATE cross_post_status SET status='published', platform_post_id, platform_url, published_at=NOW
  → On error: UPDATE cross_post_status SET status='failed', error_message=e.message, retry_count=retry_count+1
    Если retry_count >= 3: окончательная неудача
```

### 6.2 Analytics flow

```
06:00 UTC+3 — Cron trigger
  → Для каждой платформы в cross_post_config WHERE enabled=1:
     → SELECT * FROM cross_post_status WHERE platform=? AND status='published' AND platform_post_id IS NOT NULL
     → Для каждого:
        === YouTube ===
          → GET videos.list?part=statistics&id={platform_post_id}
          → Извлечь: viewCount, likeCount, commentCount
        === VK ===
          → GET video.get?videos={owner_id}_{video_id}
          → Извлечь: views, likes, comments
        === Threads ===
          → GET /me/threads?fields=like_count,comments_count,views_count
          → Извлечь: views, likes, comments
        === Rutube ===
          → GET /api/video/{id}/stat/
          → Извлечь: views, likes, comments, shares
        === Telegram ===
          → Chat boost / message stats — пока недоступны через API
          → Пропустить (оставить 0)
     → INSERT analytics_snapshots (song_id, platform, snapshot_date, views, likes, comments_count, shares)
     → ON CONFLICT(song_id, platform, snapshot_date) DO UPDATE

  → Пересчёт рейтинга:
     → Для каждой песни с analytics_snapshots:
        → Вычислить среднее за последние 30 дней:
           rating = AVG(normalized_views) * 0.4 + AVG(normalized_likes) * 0.3
                  + AVG(normalized_comments) * 0.2 + AVG(normalized_shares) * 0.1
        → Нормализация: логарифмическая шкала (log10(x+1))
        → weighted по платформам (YouTube имеет больший вес, чем Threads)
     → UPDATE songs SET rating=?, rating_updated_at=NOW WHERE id=?
```

### 6.3 Video trimming flow

```
Вход: song с длительностью > max_video_duration_sec платформы
  → R2.get(songs/{id}.mp4) → ArrayBuffer
  → import { FFmpeg } from '@ffmpeg/ffmpeg'
  → const ffmpeg = new FFmpeg()
  → await ffmpeg.load()
  → ffmpeg.writeFile('input.mp4', new Uint8Array(buffer))
  → await ffmpeg.exec(['-i', 'input.mp4', '-t', maxDurationSec.toString(), '-c', 'copy', 'output.mp4'])
  → const data = ffmpeg.readFile('output.mp4')
  → R2.put(songs/{id}-trimmed.mp4, data)
  → Использовать songs/{id}-trimmed.mp4 для загрузки на платформу
  → Добавить "(Abridged)" в title/description

Fallback при ошибке FFmpeg.wasm:
  → cross_post_status.status = 'skipped'
  → cross_post_status.error_message = 'Video too long, trimming failed'
```

---

## 7. Secrets (Worker env variables)

| Secret | Платформа | Назначение |
|--------|-----------|------------|
| `CP_YOUTUBE_REFRESH` | YouTube | OAuth refresh token (живёт ~1 год) |
| `CP_YOUTUBE_CLIENT_ID` | YouTube | OAuth Client ID |
| `CP_YOUTUBE_CLIENT_SECRET` | YouTube | OAuth Client Secret |
| `CP_YOUTUBE_CHANNEL_ID` | YouTube | ID канала для публикации |
| `CP_VK_ACCESS_TOKEN` | VK | Бессрочный access token |
| `CP_VK_GROUP_ID` | VK | ID сообщества (если постинг от группы) |
| `CP_THREADS_REFRESH` | Threads | OAuth refresh token (60 дней) |
| `CP_THREADS_ACCESS_TOKEN` | Threads | Текущий access token |
| `CP_RUTUBE_API_KEY` | Rutube | API ключ (после регистрации) |

---

## 8. Обновление wrangler.jsonc

```jsonc
{
  "triggers": {
    "crons": ["0 6 * * *", "0 8 * * *"]   // Добавлен второй cron
  }
}
```

Биндинги R2 и Queue уже добавлены ранее.

---

## 9. Миграции

### 010_create_crosspost_analytics.sql (новая)

```sql
-- Migration 010: Cross-posting and analytics tables

-- cross_post_config
CREATE TABLE IF NOT EXISTS cross_post_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT UNIQUE NOT NULL,
  enabled INTEGER DEFAULT 0,
  display_name TEXT,
  icon TEXT DEFAULT '🔗',
  max_video_duration_sec INTEGER,
  max_video_size_bytes INTEGER,
  cooldown_minutes INTEGER DEFAULT 0,
  config_json TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- cross_post_status
CREATE TABLE IF NOT EXISTS cross_post_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  platform TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  platform_post_id TEXT,
  platform_url TEXT,
  error_message TEXT,
  abridged INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(song_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_cps_song_id ON cross_post_status(song_id);
CREATE INDEX IF NOT EXISTS idx_cps_platform ON cross_post_status(platform);
CREATE INDEX IF NOT EXISTS idx_cps_status ON cross_post_status(status);

-- analytics_snapshots
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id INTEGER NOT NULL REFERENCES songs(id),
  platform TEXT NOT NULL,
  platform_post_id TEXT,
  snapshot_date TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  additional_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(song_id, platform, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_as_song_date ON analytics_snapshots(song_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_as_platform ON analytics_snapshots(platform);

-- rating field for songs
ALTER TABLE songs ADD COLUMN rating REAL DEFAULT 0;
ALTER TABLE songs ADD COLUMN rating_updated_at TEXT;

-- Pre-populate cross_post_config
INSERT INTO cross_post_config (platform, enabled, display_name, icon, max_video_duration_sec, max_video_size_bytes, sort_order) VALUES
  ('telegram', 1, 'Telegram', '✈️', NULL, 52428800, 0),
  ('youtube', 0, 'YouTube', '▶️', NULL, 274877906944, 1),
  ('vk', 0, 'VK', '💬', NULL, 1073741824, 2),
  ('threads', 0, 'Threads', '🧵', 300, 104857600, 3),
  ('rutube', 0, 'Rutube', '📺', NULL, 21474836480, 4);
```

---

## 10. Обработка ошибок

| Ситуация | Действие |
|----------|----------|
| OAuth token expired | Queue → попытка refresh; при неудаче → status=failed, error="Token expired, re-auth required" |
| Video слишком большое | FFmpeg.wasm обрезка; при ошибке → status=skipped, abridged=0 |
| Platform API временно недоступен | retry_count++ + retry через 1ч (до 3 раз) |
| Platform API вернул 403 (no rights) | status=failed, не retry |
| Platform API вернул 429 (rate limit) | retry через 1ч |
| Platform upload прерван (timeout) | retry_count++ + retry через 30мин |
| R2 video не найден | status=skipped, error="No video in R2, migrate first" |

---

## 11. Free tier учёт

| Ресурс | Расход | Как влезаем |
|--------|--------|-------------|
| Queue ops | 8 ops/day (4 отпр + 4 consumer) | Free 10k/day |
| Cron triggers | 2/day (06:00 + 08:00) | Free 5/account |
| Workers CPU | Cross-post: ~5-8s в Queue (нет 10ms лимита) | Queue consumer вне лимита fetch |
| R2 storage | trimmed версии ~2MB × 365 = 730MB/год | Free 10GB |
| KV reads | ~10/day для getFile в Queue | Free 100k/day |
| Subrequests | ~5-10 per platform per cross-post, до 50/day | Free 50/request |

---

## 12. План реализации

| Этап | Задачи |
|------|--------|
| **A: Регистрация приложений** | YouTube (Google Cloud + OAuth), VK (Standalone app), Threads (FB Developer), Rutube (партнёрская заявка) |
| **B: Миграция 010** | Создать D1 таблицы cross_post_config, cross_post_status, analytics_snapshots, songs.rating |
| **C: Worker — Queue consumer** | crosspostToPlatform() для YouTube, VK, Threads, Rutube; FFmpeg.wasm обрезка; retry logic |
| **D: Worker — Admin API** | CRUD cross_post_config; чтение cross_post_status; триггер publish/retry |
| **E: Worker — Cron** | 08:00 кросс-постинг; 06:00 аналитика + рейтинг |
| **F: Frontend админки** | Панель управления платформами; статусы кросс-постов; аналитика/рейтинг |
| **G: Deploy** | Обновить wrangler.jsonc → `npm run migrate` → `node deploy.mjs` → deploy static |

---

## 13. Открытые вопросы

1. **Rutube API** — непубличный. После получения доступа может потребоваться адаптация.
2. **Threads video upload** — Threads API принимает `video_url` (должен быть публично доступен). Нужно либо сделать R2 object публичным временно, либо использовать signed URL.
3. **FFmpeg.wasm в Workers** — требует экспериментальной проверки. Если не работает — альтернатива: GitHub Actions runner с FFmpeg.
4. **Telegram analytics** — через стандартное API не собираются. Возможно через Telegram Business API или сторонние сервисы.
5. **Рейтинг** — формула нормализации нуждается в настройке после сбора первых данных.

---

## 14. Приложение: рекомендованные интервалы (cooldown)

Основано на рекомендациях платформ и отзывах:

| Платформа | Минимальный интервал | Рекомендуемый | Причина |
|-----------|:-:|:-:|---------|
| YouTube | 0 | 1-2ч | Нет ограничений, но частые загрузки триггерят Content ID проверку |
| VK | 5 мин | 30 мин | Wall flood filter |
| Threads | 0 | 30 мин | Частые посты могут триггерить spam filter |
| Rutube | 0 | TBD | Уточнить после получения доступа к API |

По умолчанию: 30 минут. Настраивается в cross_post_config.cooldown_minutes.

---

*Конец документа. Версия 1.0 — 28 июня 2026.*
