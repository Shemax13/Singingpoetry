# ShemaxPoetry — Project State

## Overview

Telegram-бот [@ShemaxPoetryBot](https://t.me/ShemaxPoetryBot) + веб-плеер для стихов/песен.
Бот постит видео/аудио в канал @shemaxpoetry. Приложение: SPA-плеер на Cloudflare Workers + D1 + KV.

- **Worker URL**: `https://poetry.shemax.workers.dev`
- **GitHub**: `https://github.com/Shemax13/Singingpoetry`
- **Бот токен**: `<revoked-see-secrets>`
- **Account ID**: `a3aa2b215031e097488bb52593789c18`
- **Worker name**: `poetry`
- **D1 DB**: `SHEMAX_DB` (id: `c139e4fb-afee-4752-978e-f323bbec4aa7`)
- **KV namespace**: `STATIC` (id: `1994525bead042229fed7f2bd41d2f3a`)
- **Формат**: ES Module (`export default { async fetch(request, env) {...} }`)
- **Compatibility date**: `2026-06-17`, флаг `nodejs_compat`

---

## Secrets (Cloudflare Workers)

| Name | Type | Value |
|------|------|-------|
| `TELEGRAM_BOT_TOKEN` | secret_text | `<revoked-set-in-cf-secrets>` |
| `ADMIN_PASSWORD` | secret_text | `<revoked-set-in-cf-secrets>` |

`WEBHOOK_SECRET` не установлен — код теперь обрабатывает это: если undefined, проверка пропускается (webhook работает без секрета).

---

## API Endpoints (Worker)

### Public
- `GET /api/songs?limit=N&offset=N` — список песен (visible=1). **Не блокируется** на getFile — кэш греется fire-and-forget, ответ возвращается сразу
- `GET /api/songs/:id` — одна песня
- `GET /api/songs/:id/next` — следующая песня (циклически)
- `GET /api/song/:id/podcasts` — подкасты для песни
- `GET /api/media/:id` — **302 редирект** на актуальный Telegram file URL (через getFile). Если getFile не удался — fallback на tg_video_url/suno_audio_url
- `GET /api/tg-file-url/:id` — актуальный Telegram file URL (JSON)

### Webhook (Telegram)
- `POST /api/webhook?secret=...` — приём обновлений от Telegram (секрет проверяется, но WEBHOOK_SECRET не установлен → всегда ok)

### Admin (требуется Bearer token после /api/admin/login)
- `POST /api/admin/login` — вход по `ADMIN_PASSWORD`
- `POST /api/admin/setup-webhook` — настройка вебхука
- `POST /api/admin/sync` — синхронизация пропущенных обновлений
- `POST /api/admin/scan-channel` — сканирование канала (forward сообщений)
- `POST /api/admin/suno` — Suno fetch
- `POST /api/admin/daily-sync` — ежедневная синхронизация Suno
- `GET /api/admin/songs`, `POST/PUT/DELETE /api/admin/songs/:id` — CRUD
- `GET /api/admin/publications` — посты с комментариями
- `GET /api/admin/messages` — все сообщения
- `POST /api/admin/resolve-files` — резолв file_id → file_url
- `POST /api/admin/resolve-covers` — резолв cover_file_id → cover_url
- `POST /api/admin/create-songs` — создание песен из отсканированных сообщений
- `POST /api/admin/search-suno` — поиск Suno по тексту песен
- `GET /api/admin/verify-db` — статистика и верификация БД

### Static
- Все остальные пути — отдача файлов из KV (`STATIC`), ключ = путь (без ведущего `/`), `index.html` для `/`

---

## Архитектура

```
Browser → poetry.shemax.workers.dev
              │
              ├── /api/* → Worker logic (D1 + Telegram API proxy)
              │                ├── DB = D1 database (songs, messages, admin_sessions, audio_breakdowns)
              │                └── Telegram: getFile (с кэшем Map 10min TTL) + 302 redirect на media
              │
              └── /* → KV (STATIC namespace): index.html, js/, css/
```

### Media flow (текущий)
1. **`/api/songs`** — возвращается сразу (без ожидания getFile). Кэш getFile греется fire-and-forget для первых 3 песен
2. Фронтенд: `autoPlay()` ищет первый трек с `tg_video_url` (из БД) или реальным заголовком
3. Если найден с `tg_video_url` → используется напрямую (без `/api/media/:id`)
4. Если `tg_video_url` протух (expired) → error fallback на `/api/media/:id` (1 запрос к getFile)
5. **`/api/media/:id`** — getFile (in-memory cache, 10min TTL) → 302 Redirect на Telegram
6. Браузер грузит медиа напрямую с `api.telegram.org`
7. При ошибке загрузки: фронтенд прыгает к следующему playable треку через `nextPlayableIndex()`

### Media flow (старый, до 23.06.2026)
1. `/api/media/:id` → getFile (5s timeout) → fetch Telegram (10s timeout) → stream через worker
2. Полная загрузка 12MB+ видео через worker до первого байта браузеру (120с+)

---

## Cron

`0 6 * * *` — ежедневная синхронизация Suno (scheduled handler):
- Ищет песни с `suno_track_url` но без `suno_audio_url`
- Ищет песни с suno-ссылками в lyrics

---

## DB Schema (D1: SHEMAX_DB)

### songs
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| title | TEXT | |
| lyrics | TEXT | |
| tg_video_url | TEXT | Устаревший Telegram URL (файлы переезжают) |
| tg_file_id | TEXT | Актуальный file_id для getFile |
| suno_audio_url | TEXT | |
| suno_cover_url | TEXT | |
| suno_track_url | TEXT | |
| cover_url | TEXT | Обложка (протухшие Telegram URL) |
| visible | INTEGER | 0/1 |
| language | TEXT | "ru" по умолч. |
| order_index | INTEGER | Порядок |
| telegram_message_id | INTEGER | |
| published_at | TEXT | ISO datetime |
| created_at | TEXT | |
| updated_at | TEXT | |

### messages
| Column | Type |
|--------|------|
| id | INTEGER PK |
| tg_msg_id | INTEGER |
| chat_id | TEXT |
| chat_type | TEXT |
| msg_type | TEXT |
| text_content | TEXT |
| file_id | TEXT |
| file_unique_id | TEXT |
| file_url | TEXT |
| mime_type | TEXT |
| file_size | INTEGER |
| duration | INTEGER |
| file_name | TEXT |
| forward_from_chat_id | TEXT |
| forward_from_msg_id | INTEGER |
| reply_to_msg_id | INTEGER |
| reply_to_chat_id | TEXT |
| published_at | TEXT |
| cover_file_id | TEXT |
| cover_url | TEXT |

### admin_sessions
| Column | Type |
|--------|------|
| id | TEXT (токен) |
| expires_at | TEXT (datetime) |

### audio_breakdowns
| Column | Type |
|--------|------|
| id | INTEGER PK |
| song_id | INTEGER |
| title | TEXT |
| file_url | TEXT |
| duration | INTEGER |
| telegram_message_id | INTEGER |
| visible | INTEGER |

---

## Деплой

### Через API (рабочий способ)
```bash
node deploy.mjs
# требует CLOUDFLARE_API_TOKEN или CF_API_TOKEN
```

`deploy.mjs` читает `src/worker.js`, формирует multipart upload и PUT на `api.cloudflare.com`.
В metadata обязательно включает D1 + KV биндинги (иначе сбрасываются).
Секреты (secret_text) НЕ нужно указывать — они сохраняются.

### Static files (KV)
После деплоя worker нужно обновлять статику в KV:
```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/storage/kv/namespaces/<KV_ID>/values/js/app.js" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: text/javascript" \
  --data-binary "$(cat public/js/app.js)"
```
Аналогично для index.html и style.css.

### GitHub Actions
Пуш в `master` → `.github/workflows/deploy.yml` → `node deploy.mjs` с `CF_API_TOKEN` секретом.

### Токены
- **API токен** (`cfut_...`) — используется для API. Создан в Cloudflare Dashboard, права: Workers Edit.
- **OAuth токен** (`cfoat_...`) — не работает для прямых API вызовов (только с wrangler).
- GitHub секрет: `CF_API_TOKEN`.

### Важные нюансы деплоя
- `wrangler deploy` висеет на этой машине (сеть блокирует upload). `wrangler versions list`, `wrangler whoami`, `wrangler kv` — работают.
- Прямой API upload через curl/node работает (маленький пейлоад ~44KB).
- Content-Type для модуля в multipart: `application/javascript+module`.
- После upload создаётся deployment автоматически (source: "api").
- Если задеплоить без биндингов в metadata — D1 и KV теряются, worker падает с error 1101.
- Откат: `POST /accounts/:id/workers/scripts/:name/deployments` с `version_id` предыдущей версии.

---

## Фронтенд

Файлы в KV (`STATIC`):
- `index.html` — SPA
- `js/app.js` — плеер
- `css/style.css` — стили

### Ключевая логика app.js
- `const API = 'https://poetry.shemax.workers.dev/api'`
- `const MEDIA_URL_TTL = 1800000` (30 мин) — resolvedMediaUrl считается свежим (из кэша)
- `const CACHE_TTL = 1800000` (30 мин) — localStorage songs_cache
- **Cover**: всегда `/img/logo.png`
- **Video source**: `song.tg_video_url` (из БД) → `resolvedMediaUrl` (localStorage) → `/api/media/:id` (getFile)
- **Audio source**: `song.suno_audio_url` (если не Telegram) → `/api/media/:id` (если Telegram URL) → fallback chain
- **Loading indicator**: показывается сразу при `playSong()`, прячется по `canplay`/`play`/`error`
- **60s timeout** на загрузку медиа → `nextSong()`
- **Error fallback**: при ошибке `tg_video_url` → `/api/media/:id`; при ошибке `/api/media/:id` → `nextSong()`
- Аудио-визуализация (canvas + AudioContext) для аудио-режима

### Loading pipeline (текущий)
```
1. DOMContentLoaded → loadSongs()
2. Проверка localStorage cache (songs_cache, TTL 30мин)
3. Если кэш есть: autoPlay() из кэша, фоновая подгрузка свежего списка
4. Если кэша нет: fetch /api/songs?limit=25 (ответ содержит tg_video_url для 47 песен, ~0.1с)
5. autoPlay(): ищет первый трек с tg_video_url → находит (н-р, id=448 на позиции 5)
6. playSong(5): mediaSrc = song.tg_video_url (прямая ссылка, без getFile)
7. Браузер грузит видео напрямую с api.telegram.org (через прямую ссылку)
8. canplay → hide loading, play(), preloadNextSong()
9. Если tg_video_url протух → error → fallback на /api/media/:id → getFile → 302 redirect
```

---

## Известные проблемы

1. **Telegram file paths stale** — файлы на `api.telegram.org/file/bot...` переезжают. Решается через `getFile` API + 302 redirect (не буферизация).
2. **api.telegram.org недоступен** с этой машины, но доступен из Cloudflare Workers. Пользовательский браузер может достигать Telegram напрямую (через 302 redirect).
3. **Обложки** — `cover_url` в songs содержит протухшие Telegram URL. `cover_file_id` есть только в таблице messages. Для resolve нужно создавать endpoint, ищущий cover_file_id по telegram_message_id → getFile → redirect.
4. **Холодный кэш getFile** — первый запрос после долгого простоя ждёт до 15с (getFile timeout). Последующие — из in-memory Map (0мс).
5. **Worker не может загрузить статику >1MB** через KV `type:"stream"`. На практике проблем нет (все файлы <100KB).
6. **GitHub Actions deploy** — ранее падал с exit code 1 (без деталей). Нужно проверить статус после последнего коммита.
7. **Workers Builds Git integration** — может конфликтовать с GitHub Actions. Рекомендуется отключить в Cloudflare Dashboard.
8. **"Untitled" песни** — 60 новых песен созданы с заголовком "Untitled" (text_content в messages был NULL). Нужно вручную проставить названия через админку или SQL.
9. ~~**Webhook никогда не работал**~~ — Исправлено (23.06.2026)
10. ~~**AudioContext не резюмился**~~ — Исправлено (23.06.2026)
11. ~~**Stale URL 404 round-trip**~~ — Теперь фронтенд проверяет `_mediaUrlTs` и сразу использует `/api/media/:id` если URL старше 30мин (23.06.2026)
12. **Worker deploy hang** — `wrangler deploy` зависает на этой машине после "Total Upload". Используется деплой статики через KV напрямую. Worker код готов, но не деплоится.
13. **Invalid tg_file_id для 13 песен** (453-449, 447-441, 394) — файлы пересозданы, старые file_id не работают. getFile возвращает 404. Фикс: кэширование неудач (код готов, не задеплоен). При воспроизведении фронтенд пропускает их за ~200ms/шт.
14. **tg_video_url = NULL для всех новых песен** (453-394) — ИСПРАВЛЕНО (24.06.2026). Выполнен batch resolve: 47 песен получили tg_video_url через /api/media/:id → redirect URL → D1 UPDATE. 13 песен остались без URL (invalid file_id).
15. **suno_audio_url = Telegram URL, не Suno CDN** — при create-songs аудиофайлы сохраняются в поле suno_audio_url как Telegram file URL, который expires через ~1ч. Фронтенд использовал его напрямую (вместо /api/media/:id). Исправлено: если suno_audio_url указывает на api.telegram.org, используется /api/media/:id.

---

## Полезные команды

```bash
# Локальная разработка
npm run dev

# Деплой worker через API
node deploy.mjs

# Обновление статики в KV
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/a3aa2b215031e097488bb52593789c18/storage/kv/namespaces/1994525bead042229fed7f2bd41d2f3a/values/js/app.js" \
  -H "Authorization: Bearer <токен>" \
  -H "Content-Type: text/javascript" \
  --data-binary "$(cat public/js/app.js)"

# Миграции D1
npm run migrate

# Просмотр версий
npx wrangler versions list --name poetry

# KV операции
npx wrangler kv key get <key> --binding STATIC --remote
npx wrangler kv key put <key> --binding STATIC --remote --path <file>

# Live logs
npx wrangler tail --name poetry

# Откат
curl -X POST "https://api.cloudflare.com/client/v4/accounts/a3aa2b215031e097488bb52593789c18/workers/scripts/poetry/deployments" \
  -H "Authorization: Bearer <токен>" \
  -H "Content-Type: application/json" \
  -d '{"strategy":"percentage","versions":[{"version_id":"<uuid>","percentage":100}]}'
```

---

## Последние изменения (без коммитов)

```
Исправления багов (23.06.2026):
- renderMenuSongs: убран баг с `tmp = { innerHTML: '' }` (нет appendChild → вкладка Песни всегда пустая)
- worker.js: убран дублирующийся `forward_from_chat_id` (строка 196)
- worker.js: webhook secret check теперь опциональный (если не установлен — пропускается)
- worker.js: scheduled handler ловит ошибки с console.error (раньше silent catch)
- app.js: ensureAudioCtx() вызывается только в audio-режиме (раньше и в video)
- app.js: togglePodcast() теперь резюмит AudioContext перед воспроизведением
- WEBHOOK_SECRET не установлен — webhook работал всегда с ошибкой (исправлено)

Синхронизация данных (23.06.2026):
- Выполнен /api/admin/sync (0 новых, всё актуально)
- Выполнен /api/admin/resolve-covers (0, все cover_url уже заполнены)
- Создано 60 новых песен из messages (SQL bulk INSERT с tg_file_id)
- Итого: 453 песни (451 visible), 446 с tg_file_id, 344 с cover_url

Оптимизация загрузки первого трека (23.06.2026):
- worker.js /api/songs: getFile теперь fire-and-forget (не блокирует ответ). Ответ возвращается за ~0.5с вместо 1-15с
- app.js: loading indicator показывается сразу при playSong() (до установки src), а не после
- app.js: loading indicator показывается и для аудио (был только для видео)
- worker.js: удалён _mediaUrlTs (больше не нужен — первый трек всегда через /api/media/:id)

Ускорение переключения на playable треки (24.06.2026):
- worker.js: getFile кэширует неудачи (не только успешные результаты). Если file_id invalid — следующий запрос к тому же file_id не ждёт 15с таймаут, а сразу кидает ошибку (НЕ ЗАДЕПЛОЕНО)
- worker.js: KV кэш для getFile (успех + неудача). Снижает latency после cold start (НЕ ЗАДЕПЛОЕНО)
- ~~app.js: autoPlay() пропускает непроигрываемые треки — ищет первый с suno_audio_url/podcast_audio_url~~ (замена ниже)

Исправление багов плеера (24.06.2026):
- **autoPlay()**: теперь ищет первый трек с tg_video_url или реальным заголовком (не "Untitled"). Если не находит — играет первый с любым медиа. Раньше выбирал первый трек с suno_audio_url (expired Telegram URL).
- **playSong()**: для треков только с tg_file_id (без tg_video_url/suno_audio_url) подменяет suno_audio_url на `/api/media/:id` → свежий URL через getFile. Играет через audio-элемент.
- **playSong()**: для suno_audio_url с api.telegram.org использует `/api/media/:id` вместо прямого expired URL. Fallback на stale suno_audio_url при ошибке.
- **audio error handler**: добавлено скрытие индикатора загрузки (ранее loading indicator висел вечно при ошибке аудио).
- **nextPlayableIndex()**: ищет треки с любым медиа (tg_file_id/tg_video_url/suno_audio_url/podcast_audio_url).
- **loadSongs()**: двухфазная загрузка. Фаза 1: первые 25 треков (быстро, ~0.1с) → autoPlay(). Фаза 2: догрузка остальных чанками по 25. В кэше localStorage сохраняется полный список (100+ треков).
- **autoPlay()**: приоритет трекам с tg_video_url или реальным названием — находит песню 393 (offset ~60) с видео и заголовком.

Deploy note (24.06.2026):
- Frontend-изменения задеплоены через `wrangler kv key put`
- Worker код с failure caching + KV cache НЕ задеплоен (wrangler deploy висит на upload)

Batch resolve tg_file_id (24.06.2026):
- Скрипт resolve_via_worker.sh: для id 453–394 вызывает /api/media/:id (worker делает getFile), извлекает redirect URL, сохраняет в D1 через `wrangler d1 execute`
- Результат: 47 песен получили tg_video_url, 13 остались без (invalid file_id)
- Фронтенд: playSong() теперь использует `song.tg_video_url` напрямую (без getFile) для source. Запасной вариант: `/api/media/:id` (1 запрос к getFile) при ошибке или отсутствии tg_video_url
```

Админка: плеер во всплывающем окне (25.06.2026):
- Добавлен play-модал в `public/admin/index.html` (#playerModal) с video/audio плеером
- Добавлена колонка "Play" (▶) в таблице песен админки
- `openPlayer()` использует `/api/media/:id` для Telegram-медиа (видео/аудио с api.telegram.org)
- Для Suno CDN-аудио (cdn2.suno.ai) — прямая ссылка, без прокси
- Для `podcast_audio_url` — прямая ссылка
- Кнопка показывается только для треков с любым медиа (tg_video_url/suno_audio_url/podcast_audio_url/tg_file_id)
- Файлы: `public/admin/index.html` (inline override + модал + CSS) + `public/js/admin.js` (openPlayer/closePlayer)

Смена пароля (25.06.2026):
- ADMIN_PASSWORD → <revoked> (см. KV/variables)

Проблемы с деплоем статики (25.06.2026):
- `wrangler kv key put` и `wrangler deploy` зависают на этой машине (сеть блокирует upload > ~24KB)
- Admin.html (24KB): upload через `wrangler kv key put --remote` работает после таймаута (~60-120с)
- Admin.js (26KB): upload НЕ работает (таймаут/fetch failed)
- Решение: `wrangler deploy` — зависает после "Total Upload", но файлы в KV обновляются. Либо загружать через gzip-трюк (см. ниже).
- Gzip-трюк: `gzip -c file > /tmp/file.gz && curl -X PUT ... -H "Content-Encoding: gzip" --data-binary @/tmp/file.gz` — Cloudflare KV API не декомпрессит (игнорирует Content-Encoding), хранит сырые gzip-байты → браузер получает gzip с Content-Type text/html → не работает.
- Рабочий способ: `npx wrangler kv key put --namespace-id <NS> <key> --path <file> --remote` — ждать 60-120с, ignore "terminated" error.
- Итог: admin.html задеплоен (с плеером и inline override), admin.js задеплоен (с openPlayer).

---

## Static files in KV

Файлы в KV (`STATIC`, namespace: `1994525bead042229fed7f2bd41d2f3a`):
- `index.html` — SPA плеер
- `js/app.js` — плеер
- `js/admin.js` — админка (логика: CRUD, синхронизация, плеер)
- `css/style.css` — стили
- `admin/index.html` — страница админки (включает inline override openPlayer)

### Admin play feature (25.06.2026)

`admin/index.html`:
- HTML/CSS: модал #playerModal с video/audio тегами и CSS-стилями
- Inline override `openPlayer()` — приоритет: `/api/media/:id` для Telegram медиа, прямая ссылка для Suno CDN и подкастов

`js/admin.js`:
- `openPlayer(id)` — поиск песни, определение типа (video/audio), создание DOM-элемента с источником
- `closePlayer()` — очистка и скрытие модала
- `renderSongsTableWith()` — добавлена колонка "Play" с ▶ кнопкой (условие: tg_video_url/suno_audio_url/podcast_audio_url/tg_file_id)

## Исправление багов (25.06.2026, v2)

**Critical: upsertSong терял данные при частичном UPDATE**
- `upsertSong()` в worker.js: UPDATE всегда устанавливал ВСЕ колонки. Если `toggleVisibility()` (или любой другой caller) отправлял только `{visible: 1}`, остальные поля (title, lyrics, tg_video_url, etc.) затирались NULL.
- Фикс: динамическое построение UPDATE — только поля, присутствующие в объекте, попадают в SET. `updated_at` всегда обновляется.
- Дополнительно: `toggleVisibility()` в admin.js теперь отправляет полный объект песни (не только `{visible: 1}`).
- Дополнительно: `saveEdit()` в admin.js включает все поля existing-песни (visible, order_index, tg_file_id, suno_audio_url, telegram_message_id, published_at), чтобы избежать случайного затирания.

**Critical: firstLine(null) → crash**
- `firstLine()` в worker.js: при caption=null вызывала `caption.split("\n")`, что падало с TypeError.
- Фикс: добавлена проверка `if(!caption) return "Untitled"`.

**Critical: autoPlay() не пропускал непроигрываемые треки**
- `autoPlay()` в app.js: всегда стартовал с индекса 0, даже если у первого трека нет медиа. Тогда `playSong(0)` сразу делал `return` и плеер не запускался.
- Фикс: цикл по очереди, поиск первого трека с любым медиа (tg_video_url/suno_audio_url/podcast_audio_url/tg_file_id).

**Critical: podcast audio использовал неверный source**
- `playSong()` в app.js: в ветке `hasPodcastAudio` использовался `mediaSrc` (который равен `song.tg_video_url`), а не `song.podcast_audio_url`. Подкасты играли не тот файл (или silent fallback на /api/media/:id).
- Фикс: `var podcastSrc = song.podcast_audio_url`, используется как src для audio-элемента.

**Critical: webhook не восстанавливался при ошибке sync**
- `/api/admin/sync` в worker.js: удалял вебхук, делал `getUpdates`, потом восстанавливал. Если между удалением и восстановлением возникало исключение, вебхук оставался удалённым → бот переставал получать обновления.
- Фикс: получение oldUrl до try, восстановление в finally.

**High: XSS через cover_url в side screens**
- `updateSideScreens()` в app.js: `lc.innerHTML = '<img ... data-src="' + lcUrl + '">'` — lcUrl вставлялся без экранирования через `innerHTML`. Злоумышленник с cover_url типа `" onerror="alert(1)` получал XSS в боковых экранах.
- Фикс: замена innerHTML на createElement/appendChild.

**High: podcast_count считал невидимые подкасты**
- SQL в worker.js: `SELECT COUNT(*) FROM audio_breakdowns WHERE song_id=s.id` (без `visible=1`).
- Фикс: добавлено условие `AND visible=1`.

**High: openPlayer считал tg_file_id видео**
- `isVideo = !!song.tg_video_url || !!song.tg_file_id` — tg_file_id часто относится к аудио, но маркировалось как video. Плеер вставлял `<video>` для аудиофайлов.
- Фикс: `isVideo = !!song.tg_video_url` (без tg_file_id).

**Medium: отсутствующие индексы** — ИСПРАВЛЕНО
- `audio_breakdowns.song_id` — нет индекса. Полный scan таблицы при каждом запросе песен (подзапрос `podcast_audio_url`).
- `messages.forward_from_msg_id` — нет индекса. Используется в `getPublications()`.
- `messages.reply_to_msg_id` — нет индекса. Используется в `getPublications()`.
- `messages.chat_type` — нет индекса. Используется в `getMessages()` и `/api/admin/audio-files`.
- Фикс: создана миграция `migrations/005_add_indexes.sql`. Выполнить `npm run migrate`.

**Low: код не форматирован, линтинг не настроен**
- Код в worker.js использует ES5-стиль (var, function), не ES6+.
- Нет Prettier/ESLint конфига.
- Не критично для функциональности, но усложняет поддержку.

---

## Исправление багов (25.06.2026, v3 — аудит всего кода)

**Critical: play button не открывал плеер**
- Минификация HTML переименовала `openPlayer` → `op`, inline override не переопределял admin.js.
- Кнопка ▶ вызывала `openPlayer(id)` из admin.js, который искал `id="playerModal"` (а в HTML `id="pm"`) → `$()` не находил элемент → падение TypeError.
- Фикс: inline override использует `openPlayer` с корректным именем и DOM-ссылками `$('pm')`, `$('pt')`, `$('pc')`.

**Critical: 302 redirect на Telegram CDN не работал в браузере**
- `/api/media/:id` возвращал 302 на Telegram, браузеры не всегда следовали cross-origin редиректу для video/audio.
- Фикс: JSON-эндпоинт `/api/tg-file-url/:id` — fetch свежего getFile URL напрямую (без редиректа).

**Critical: крестик окна плеера не закрывал видео**
- HTML содержит `onclick="cp()"`, но функция `cp` не определена нигде в коде.
- Фикс: добавлена `function cp()` в inline override — очищает контейнер, паузит медиа, скрывает модал.

**Critical: `editSong(null)` не открывал модал добавления новой песни**
- `admin.js:187-189`: `songs.find(s => s.id === null)` → undefined → `if (!song) return;`.
- Фикс: инициализация полей по умолчанию до проверки `id`, показ модала всегда.

**Critical: отсутствие алиасов для минифицированных имён в админке**
- HTML вызывает `lP()`, `ce()`, `se()`, `sPS()` — ни одна не определена.
- `st('publications',this)` → `lP()` не вызывается → Publications tab пустой.
- Cancel/Save в edit-модале вызывают `ce()`/`se()` → кнопки не работали.
- Attach Podcast вызывает `sPS()` → кнопка не работала.
- Фикс: добавлены глобальные алиасы `var lP=loadPublications; var ce=closeEdit; var se=saveEdit; var sPS=showPodcastSelector` в inline override.

**Critical: public endpoints возвращали hidden/deleted песни**
- `GET /api/songs/:id`, `/api/media/:id`, `/api/tg-file-url/:id` использовали `getSong()` без `visible=1`.
- Фикс: создан `getPublicSong(id)` с фильтром `WHERE id=? AND visible=1`.

**High: `request.json()` вне try-catch в 6 admin endpoints**
- При malformed JSON → необработанное исключение → 500 + утечка в ответе.
- Фикс: создана функция `safeJSON(req)` + null-проверки; заменены все `await request.json()` в admin.

**High: `|| null` затирал `order_index: 0`**
- `(s[k] || null)` → falsy `0` превращается в null.
- Фикс: `s[k]===undefined||s[k]===null ? null : s[k]`.

**Low: `--radius-lg` не определён в admin CSS**
- Используется в `.auth-box`, `.admin-card`, `.modal-content` → border-radius падал до 0.
- Фикс: добавлено `--radius-lg:16px` в admin `:root`.

**Реорганизация данных: пересортировка песен по порядку Telegram канала**
- `order_index` пересчитан для 250 песен с mp4 (tg_video_url): установлен последовательный номер (1-250) по возрастанию `telegram_message_id`
- Старые песни (msg_id=6) → order_index=1, новые (msg_id=524) → order_index=250
- Фронтенд сортирует `ORDER BY order_index ASC, id DESC` → песни идут в порядке канала

**Admin: фильтр только mp4 по умолчанию**
- Добавлен `mp4Only` флаг (true по умолчанию) — список песен показывает только записи с tg_video_url
- Кнопка "MP4 only" / "All songs" в админке для переключения
- Статистика: добавлен счётчик "With MP4"

--- 

## Известные проблемы (дополнение)

1. **Admin.js деплоится нестабильно** — `wrangler kv` зависает на upload >24KB. Загружен только один раз (неделю назад), текущая версия admin.js может быть устаревшей в KV.
2. **Inline override разрастается** — вся логика плеера продублирована в admin/index.html. При изменении admin.js нужно синхронизировать inline override вручную.
3. **`/api/tg-file-url/:id` без auth** — публичный эндпоинт, хотя используется только из админки. Злоумышленник может ддосить Telegram API.
4. **mediaCache Map никогда не очищается** — растёт бесконечно в течение жизни изолята Worker (потенциальная утечка памяти).

---

## Todo / Next Steps

1. [x] **Resolve tg_file_id → обновить tg_video_url в БД** — Выполнено скриптом resolve_via_worker.sh: 47 песен обновлены, 13 остались без URL (invalid file_id)
2. [x] **Inline override синхронизация** — admin/index.html inline override синхронизирован с admin.js (openPlayer, closePlayer, aliases)
3. [x] **Исправления admin/index.html** — добавлены cp(), lP, ce, se, sPS алиасы; --radius-lg; editSong(null) фикс
4. [ ] **Задеплоить worker** (failure caching + KV cache + upsertSong fix + webhook fix + safeJSON + public song filter) — нужен прямой API upload.
5. [ ] **Добавить ежедневный cron для refresh tg_video_url** — обновлять через `/api/media/:id` для всех песен с tg_file_id (или через запланированный эндпоинт в worker)
6. [ ] Создать endpoint `/api/cover/:id` для resolve обложек через cover_file_id из messages → getFile → redirect
7. [ ] Проставить названия для 60 новых песен (сейчас "Untitled")
8. [ ] Отключить Workers Builds Git integration в Dashboard Cloudflare
9. [ ] Long-term: мигрировать медиа на R2 (чтобы избавиться от Telegram)
10. [x] Пересортировать песни по порядку Telegram канала — order_index = 1-250 по telegram_message_id ASC (только mp4)
11. [ ] Push коммитов на GitHub (локальные изменения не синхронизированы с git)
12. [x] **Создать индексы в D1**: `005_add_indexes.sql` — нужно выполнить через `npm run migrate` или `wrangler d1 execute`
13. [ ] **Деплой обновлённой статики в KV**: admin/index.html + admin.js + worker.js — загрузить через `npx wrangler kv key put` (ждать 60-120с) или прямой API

---

## Последние изменения (26.06.2026) — полный аудит v4

### Исправление ошибок

**Cover URL overwrite bug** — `admin.js:221`
- `editSong()` устанавливал `editCoverUrl.value = song.suno_cover_url || song.cover_url` — при наличии Suno-обложки оригинальная cover_url не отображалась и не сохранялась
- Фикс: раздельное чтение `song.cover_url || ''` и `song.suno_cover_url || ''`

**saveEdit() без проверки ошибок** — `admin.js:274-276`
- Результат `api()` не проверялся → при ошибке модал закрывался, кэш чистился, пользователь не видел ошибки
- Фикс: `if (!res.ok) { alert(res.error || 'Save failed'); return; }`

**Cache refresh truncation** — `app.js:52`
- Фоновый refresh грузил `?limit=100` → 150+ песен терялись после 30 мин
- Фикс: чанковая загрузка всех песен (как initial load)

**resolvedMediaUrl stale cache** — `app.js:135-137`
- При истечении TTL кэшированный URL оставался на объекте песни, никогда не чистился
- Фикс: при истечении TTL — `delete song.resolvedMediaUrl; delete song._mediaUrlTs;`

**sync handler: telegram_message_id для forwarded сообщений** — `worker.js:532-535`
- `telegram_message_id = p.tg_msg_id` (group msg ID) вместо `p.forward_from_msg_id` (channel msg ID)
- Фикс: `var msgId = p.forward_from_msg_id || p.tg_msg_id`

**import-channel: request.json() без safeJSON** — `worker.js:491`
- `await request.json()` без try-catch + нет `!body` guard → TypeError при невалидном JSON
- Фикс: `await safeJSON(request)` + `if(!body)return err(...)`

**webhook: request.json() без safeJSON** — `worker.js:348`
- Внутри try-catch, но всё равно лучше safeJSON
- Фикс: `await safeJSON(request)`

**safeJSON создавался на каждый запрос** — `worker.js:294`
- `async function safeJSON(req){...}` внутри fetch() → редекларация на каждый запрос
- Фикс: вынесен на уровень модуля (строка 1)

**parseInt без radix (×28)** — worker.js (×24), admin.js (×4), app.js (×4)
- Все `parseInt()` без второго аргумента — поведение зависит от реализации
- Фикс: добавлен `,10` во все вызовы

### Оптимизация загрузки и воспроизведения

**Chunk size увеличен 25→100**
- Загрузка 250 песен: 3 запроса вместо 10
- Initial load: `?limit=100` → autoPlay() быстрее

**Background refresh: загрузка всех песен**
- Раньше: `?limit=100` → потеря песен 101+
- Теперь: чанковый цикл до полной загрузки (как initial load)

**preloadNextSong: resolve реального media URL**
- Раньше: `<link rel=prefetch as=fetch href=/media/:id>` — prefetch 302 redirect, не греет медиа
- Теперь: для `tg_file_id` → fetch `/api/tg-file-url/:id` в фоне → кэш на `song.resolvedMediaUrl` → prefetch реального URL с `as=audio`
- Для прямых URL (`tg_video_url`, `suno_audio_url`, `podcast_audio_url`) → prefetch напрямую с правильным `as=video/audio`

**resolvedMediaUrl TTL: stale-кэш чистится**
- При истечении 30 мин: `delete song.resolvedMediaUrl` вместо игнорирования

**loadSongs: двухфазная загрузка оптимизирована**
- Фаза 1: `?limit=100` (было 25) → autoPlay() быстрее
- Фаза 2: догрузка чанками по 100 (было 25)

### Данные в D1 (26.06.2026)
- 453 total песен, 394 visible, 297 с mp4
- **0 "Untitled"** песен (было ~60)
- order_index 1–452, sorted by telegram_message_id ASC
- Новые индексы: `005_add_indexes.sql` (audio_breakdowns.song_id, messages.forward_from_msg_id, messages.reply_to_msg_id, messages.chat_type)

### Известные проблемы (26.06.2026)

1. **Не задеплоено** — все исправления в worker.js, admin.js, app.js только локально. В проде работает старая версия (admin/index.html задеплоен с inline override).
2. **GitHub Actions не проверен** — развёрнут workflow с deploy + deploy-static, но не тестировался.
3. **Media cache Map не чистится** — `mediaCache` в worker.js растёт бесконечно.
4. **Подкасты не синхронизированы** — audio_breakdowns для новых песен (id > 393) не заполнены. (Миграция 007 перенесла данные в extra_audio, больше не актуально.)
5. **R2 bucket не включён** — API возвращает 403. Этап 1 заблокирован до включения R2 в Dashboard.

### Todo (28.06.2026)

| Приоритет | Задача |
|-----------|--------|
| 🔴 High | Деплой worker.js через GitHub Actions или прямой API |
| 🔴 High | Деплой admin.js + app.js в KV |
| 🟡 Medium | Push на GitHub (все локальные изменения) |
| 🟡 Medium | Проверить GitHub Actions — отключить Workers Builds |
| 🟢 Low | Настроить ESLint/Prettier |
| 🟢 Low | Миграция медиа на R2 (long-term) — заблокировано, R2 выключен |

---

## Последние изменения (28.06.2026) — Этап 3: Поиск и фильтрация + UI flow

### UI flow: 3 окна с историей
- **Левое окно**: предыдущая песня по дате (auto-play после окончания текущей)
- **Центральное окно**: текущая песня
- **Правое окно**: последняя завершённая песня (для повторного прослушивания). При начальной загрузке — случайная песня.
- При окончании песни: она перемещается в правое окно, левая становится центральной, в левую загружается следующая по дате
- `lastPlayedIndex` — трекер завершённых песен
- `playRight()` теперь играет последнюю завершённую песню (с fallback на random)

### Поиск и фильтрация
- **Поиск**: по `title` + `lyrics` (client-side, все ~450 песен уже в `playerQueue`)
- **Debounce**: 200ms задержка перед фильтрацией
- **Фильтр языка**: кнопки RU/EN/Все в панели песен, фильтрация по полю `language`
- Поле поиска и кнопки языка в одной строке (`.menu-search-row`)
- **Файлы**: `public/js/app.js`, `public/index.html`, `public/css/style.css`, `public/js/i18n.js`
- **Деплой**: только локально (не задеплоено, ждём этапы 1-6)

---

## Последние изменения (28.06.2026) — Этапы 6, 2, 4, 5 (все кроме 1)

### Этап 6: Структурированные логи + дедупликация webhook
- `slog()` — каждая строка лога = JSON с `service`, `level`, `msg`, `requestId`, `ts`, `data`
- `requestId` (8 hex chars) на каждый запрос
- Webhook dedup: проверка `getMessageByChatAndMsg()` перед `storeMessage()`, проверка `getByTgMsg()` перед созданием песни
- Все `console.error()` заменены на `slog("error", ...)`
- `parseMsgFull(null)` — добавлен null-guard (чинит тест)

### Этап 2: Suno metadata
- `sunoFetchCache` в `utils.js` — in-memory Map с TTL 1ч, избегаем дублирующих запросов к opensuno
- `metadata_reviews` таблица: создание при обнаружении новых Suno данных, админ endpoints: `GET /api/admin/reviews`, `POST /api/admin/reviews` (approve/reject)
- `resolveReview()` — применяет `new_value` к полю песни при approve
- Cron изменён на 08:00 в wrangler.jsonc

### Этап 4: extra_audio CRUD (вместо audio_breakdowns)
- Миграция 007 удалила `audio_breakdowns` и создала `extra_audio` (с поддержкой `r2_key`, `file_type`, `source`)
- Все подзапросы в `db.js` переписаны на `extra_audio` (с фильтром `file_type='podcast'`)
- `deleteSong()` теперь чистит и `extra_audio`
- Новые методы: `getExtraAudio()`, `upsertExtraAudio()`, `deleteExtraAudio()`
- Admin endpoints: `GET /api/admin/songs/:id/extra-audio`, `POST /api/admin/extra-audio`, `PUT/DELETE /api/admin/extra-audio/:id`
- Публичный endpoint: `GET /api/song/:id/podcasts` теперь через `d.getExtraAudio()`

### Этап 5: Внешние ссылки
- Таблицы `external_link_types` (предзаполнено: Instagram 📷, TikTok 🎵, VK 💬) и `song_external_links`
- Admin CRUD: `GET/POST /api/admin/link-types`, `DELETE /api/admin/link-types/:id`
- Admin CRUD: `GET/POST /api/admin/song-links`, `DELETE /api/admin/song-links/:id`
- Публичный endpoint: `GET /api/song/:id/links`
- Frontend: 🔗 кнопка рядом с кнопкой подкаста, открывает popup со ссылками (иконка + название платформы)
- Popup загружает ссылки асинхронно при смене песни, скрывает кнопку если ссылок нет
- Фильтр `file_type='podcast'` в подзапросах для корректного подсчёта подкастов

### Файлы: все изменения
| Файл | Этапы |
|------|-------|
| `src/worker.js` | 6 (slog, webhook dedup, requestId), 2 (review endpoints), 4 (extra_audio endpoints), 5 (link endpoints) |
| `src/db.js` | 4 (audio_breakdowns→extra_audio), 2 (metadata_reviews), 5 (external_links) |
| `src/utils.js` | 2 (sunoFetchCache), 6 (parseMsgFull null-guard) |
| `public/js/app.js` | 5 (🔗 popup, loadLinks, renderLinks) |
| `public/js/i18n.js` | 5 (externalLinks key) |
| `public/index.html` | 5 (🔗 button, links popup) |
| `public/css/style.css` | 5 (links popup styles) |
| `wrangler.jsonc` | 2 (cron 08:00) |
