# ShemaxPoetry — Handover

## Проект
Telegram-бот [@ShemaxPoetryBot](https://t.me/ShemaxPoetryBot) + веб-плеер для стихов/песен.
Сайт: https://poetry.shemax.workers.dev

## Текущее состояние

### Что работает
- Плеер на сайте, переключение треков, фильтрация, язык (ru/en)
- Админка: вход, CRUD песен, синхронизация, сканирование канала, плеер в модале
- Telegram webhook — бот принимает новые посты и создаёт/обновляет песни
- Cron: ежедневная синхронизация Suno в 6:00 UTC
- Фильтр mp4-only в админке (по умолчанию), кнопка переключения

### Что починено (июнь 2026)
- Inline override плеера в admin/index.html — openPlayer, cp(), aliases lP/ce/se/sPS
- Cover URL overwrite bug — editCoverUrl и editSunoCoverUrl теперь независимы
- all parseInt() с radix-10 (28 вызовов в 3 файлах)
- safeJSON() вынесен в module scope, все request.json() защищены
- Sync handler: telegram_message_id = forward_from_msg_id для forwarded сообщений
- saveEdit() — добавлена проверка ответа API
- resolvedMediaUrl TTL — stale-кэш чистится (delete), не висит мёртвым грузом
- Background refresh в app.js — загружает ВСЕ песни (было только 100)
- Media preload — prefetch реального URL вместо 302 redirect

### Архитектура
```
Browser → poetry.shemax.workers.dev
  ├── /api/* → Worker (D1 DB + Telegram API)
  ├── /* → KV (STATIC): index.html, js/, css/
  └── /admin/index.html → KV (admin панель)
```

### Данные
- 453 total песен, 394 visible, 297 с mp4 (tg_video_url)
- 0 "Untitled" песен
- order_index 1-452, сортировка по telegram_message_id ASC
- Telegram message ids: 6–524

### Деплой
```bash
# Worker
node deploy.mjs   # требует CLOUDFLARE_API_TOKEN

# Static в KV
npx wrangler kv key put --namespace-id 1994525bead042229fed7f2bd41d2f3a <key> --path <file> --remote

# Миграции D1
npm run migrate

# Секреты
TELEGRAM_BOT_TOKEN, ADMIN_PASSWORD, WEBHOOK_SECRET
```

### Проблемы сети
- upload >24KB зависает на этой машине (wrangler + прямой API)
- GitHub Actions deploy — настроен, но не проверен после последних коммитов
- В `deploy.yml` есть job `deploy-static` для 6 файлов KV

### Что дальше
1. [ ] **Задеплоить worker.js** (safeJSON, getPublicSong, parseInt, sync fix, import-channel fix) — через GitHub Actions или с другого соединения
2. [ ] **Задеплоить admin.js** (cover URL fix, saveEdit error handling, parseInt) — в KV
3. [ ] **Задеплоить app.js** (chunk 100, full background refresh, preload, resolvedMediaUrl fix) — в KV
4. [ ] **Выполнить миграцию** `npm run migrate` (005_add_indexes.sql — 4 индекса)
5. [ ] **Push на GitHub** — все локальные изменения не в git
6. [ ] **Проверить GitHub Actions** — отключить Workers Builds в Dashboard, если конфликтует
7. [ ] **Проставить названия** — 0 Untitled (готово), но проверить новые песни
8. [ ] **Подкасты** — audio_breakdowns не синхронизированы с новыми песнями

### Контакты
- Worker: poetry
- Account: a3aa2b215031e097488bb52593789c18
- D1: c139e4fb-afee-4752-978e-f323bbec4aa7
- KV: 1994525bead042229fed7f2bd41d2f3a

### Важно
- В админке показываются ТОЛЬКО песни с mp4 (tg_video_url). Остальные скрыты.
- Порядок песен = порядок в Telegram канале (по возрастанию telegram_message_id)
- app.js содержит кэш localStorage (30 мин TTL), stale resolvedMediaUrl чистится автоматически
- При переключении в новый чат: скопировать HANDOVER.md + PROJECT_STATE.md + deploy.yml
