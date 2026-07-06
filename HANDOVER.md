# ShemaxPoetry — Handover

## Проект
Telegram-бот [@ShemaxPoetryBot](https://t.me/ShemaxPoetryBot) + веб-плеер для стихов/песен.
Сайт: https://poetry.shemaxpoetry.workers.dev

## Аккаунты (ВАЖНО!)

**Основной аккаунт (рабочий):** `02a5ee785952a4e4b7b6da209e10c53d` (Shemax45@gmail.com)
- Worker `poetry`, D1 `SHEMAX_DB`, KV `STATIC` — всё здесь
- 453 песни, всё работает

**Не путать с:** `a3aa2b215031e097488bb52593789c18` (Shemax@mail.ru)
- Там пустой аккаунт, worker `poetry` есть, но без данных

## Текущее состояние

### Что работает
- Плеер на сайте, переключение треков, фильтрация, язык (ru/en)
- Админка: вход, CRUD песен, синхронизация, сканирование канала, плеер в модале
- Telegram webhook — бот принимает новые посты и создаёт/обновляет песни
- Cron: ежедневная синхронизация Suno в 8:00 UTC
- Фильтр mp4-only в админке (по умолчанию), кнопка переключения
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Rate limiter на API

### Что починено (июнь-июль 2026)
- Inline override плеера в admin/index.html — openPlayer, cp(), aliases lP/ce/se/sPS
- Cover URL overwrite bug — editCoverUrl и editSunoCoverUrl теперь независимы
- all parseInt() с radix-10 (28 вызовов в 3 файлах)
- safeJSON() вынесен в module scope, все request.json() защищены
- Sync handler: telegram_message_id = forward_from_msg_id для forwarded сообщений
- saveEdit() — добавлена проверка ответа API
- resolvedMediaUrl TTL — stale-кэш чистится (delete), не висит мёртвым грузом
- Background refresh в app.js — загружает ВСЕ песни (было только 100)
- Media preload — prefetch реального URL вместо 302 redirect
- Security: CSP headers, `/api/privacy`, `tg_file_id` скрыт из публичного API
- `/api/tg-file-url/:id` — удалён

### Архитектура
```
Browser → poetry.shemaxpoetry.workers.dev
  ├── /api/* → Worker (D1 DB + Telegram API)
  ├── /* → KV (STATIC): index.html, js/, css/
  └── /admin/index.html → KV (admin панель)
```

### Данные
- 453 total песен, 394 visible, 297 с mp4 (tg_video_url)
- 0 "Untitled" песен
- order_index 1-452, сортировка по telegram_message_id ASC
- Telegram message ids: 6–524

### Инфраструктура
| Ресурс | ID | Название |
|--------|----|----------|
| Account | `02a5ee785952a4e4b7b6da209e10c53d` | Shemax45@gmail.com |
| Worker | `poetry` | script_tag: `72b3b6c81f7d44b590e56d41f6c75eed` |
| D1 DB | `9f979733-d291-4e4a-af29-7cb463ca534a` | SHEMAX_DB |
| KV | `fd50e45d91a6485b944e69056960dccd` | STATIC |
| API Token | `cfoat_g2v95oseWcV1V3A5oHG32t6-KVNF1IOOy0Pd3BvOxGY.5nfuPesjyvocXqk8sBwq0nklPsNcouqQC_Ll8_Nqos8` | — |

### Secrets (установлены)
- `TELEGRAM_BOT_TOKEN` ✅
- `ADMIN_PASSWORD` ✅
- `TURNSTILE_SECRET_KEY` ✅
- `WEBHOOK_SECRET` ❌ (не обязателен — код работает без него)

## Деплой

### Основной способ: Workers Builds (рекомендуется)
Push в `master` → авто-деплой через Dashboard Cloudflare:
```bash
git add -A && git commit -m "message" && git push
```
Deploy command: `npx wrangler deploy` (без build-команды)
Source: 81.16 KiB raw / 16.57 KiB gzip

### Запасной способ: через deploy.mjs (только для source ≤20KB)
```bash
node deploy.mjs   # требует CLOUDFLARE_API_TOKEN
# ВНИМАНИЕ: PUT лимит 25KB — таймаут при source ≥25KB!
```

### Static в KV
```bash
npx wrangler kv key put --namespace-id fd50e45d91a6485b944e69056960dccd <key> --path <file> --remote
```

### Миграции D1
```bash
npm run migrate
```

## Важные ограничения
- **API PUT лимит 25KB**: прямой деплой через Cloudflare API таймаутится при source >25KB
- **Workers Builds обходит лимит**: сборка внутри Cloudflare, лимита нет
- Workers Builds использует `wrangler.jsonc` для bindings и account_id
- После деплоя через Workers Builds URL меняется на `https://poetry.shemaxpoetry.workers.dev`

## Security (06.07.2026)
- Content-Security-Policy headers
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- `/api/privacy` endpoint
- `tg_file_id` скрыт из публичного API
- Rate limiter

## Что дальше
1. [ ] Проверить новые песни после деплоя
2. [ ] Подкасты — audio_breakdowns не синхронизированы с новыми песнями
3. [ ] Дальнейшие этапы по shemaxplan.md

## Контакты
- Worker: poetry (account 02a5ee...)
- URL: https://poetry.shemaxpoetry.workers.dev
- GitHub: https://github.com/Shemax13/Singingpoetry
