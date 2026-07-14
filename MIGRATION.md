# Shemaxpoetry — Migration to Yandex Cloud

## Status
- **Статика**: ✅ Yandex Object Storage (бакет `shemaxpoetry`)
- **Бэкенд (API, DB, cron)**: ❌ Всё ещё на Cloudflare Workers
- **DNS/домен**: ❌ Не настроен — временно `*.website.yandexcloud.net`

---

## 1. Static Hosting (Yandex Object Storage)

### Bucket
- **Имя**: `shemaxpoetry`
- **URL**: https://shemaxpoetry.website.yandexcloud.net/
- **Регион**: `ru-central1`
- **Публичный доступ**: включён
- **Статический хостинг**: включён (index.html)
- **CacheControl**: `no-cache` на все файлы

### S3 Credentials
```yaml
aws_access_key_id: <your-access-key>
aws_secret_access_key: <your-secret-key>
endpoint_url: https://storage.yandexcloud.net
region: ru-central1
```

### Deployed files (8)
| File | Size | Type |
|------|------|------|
| `/` (`index.html`) | 7496 B | text/html |
| `css/style.css` | ~10 KB | text/css |
| `js/app.js` | 26584 B | application/javascript |
| `js/i18n.js` | ~ | application/javascript |
| `js/admin.js` | ~ | application/javascript |
| `img/logo.png` | ~ | image/png |
| `img/favicon.ico` | ~ | image/x-icon |
| `admin/index.html` | ~ | text/html |

### Upload script (Python)
```python
import boto3
from botocore.client import Config

s3 = boto3.client('s3',
    endpoint_url='https://storage.yandexcloud.net',
    region_name='ru-central1',
    aws_access_key_id='<your-access-key>',
    aws_secret_access_key='<your-secret-key>',
    config=Config(signature_version='s3v4', s3={'addressing_style': 'path'})
)

BUCKET = 'shemaxpoetry'
s3.put_object(Bucket=BUCKET, Key='index.html', Body=data,
    ContentType='text/html; charset=utf-8', ACL='public-read',
    CacheControl='no-cache')
```

---

## 2. Frontend Features & Fixes

### Logo click handler
- **Файл**: `public/index.html` → `<span class="main-logo" id="mainLogo">`
- **Файл**: `public/js/app.js` → `$('mainLogo').addEventListener('click', function() { window.open('https://t.me/shemaxpoetry', '_blank'); });`

### CSP meta tag (в index.html)
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self' https://shemaxpoetry.website.yandexcloud.net;
  connect-src 'self' https://poetry.shemax.workers.dev https://suno-api-psi.vercel.app https://cdn1.suno.ai https://cdn2.suno.ai;
  media-src 'self' https://cdn1.suno.ai https://cdn2.suno.ai https://api.telegram.org blob:;
  img-src 'self' https://cdn1.suno.ai https://cdn2.suno.ai data:;
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  font-src 'self' data:;
  frame-src 'none';
">
```

### Canonical URL / OG tags (в index.html)
```html
<link rel="canonical" href="https://shemaxpoetry.website.yandexcloud.net/">
<meta property="og:url" content="https://shemaxpoetry.website.yandexcloud.net/">
```

### External API endpoints used by frontend
- `https://poetry.shemax.workers.dev/api` — основной API (всё ещё CF Worker)
- `https://suno-api-psi.vercel.app` — Suno API (прокси)
- `https://cdn1.suno.ai`, `https://cdn2.suno.ai` — Suno медиа

---

## 3. Backend (still on Cloudflare)

### CF Worker
- **Worker name**: `poetry`
- **Route**: `poetry.shemax.workers.dev/api/*`
- **Bindings**:
  - `DB` — D1 database (`poetry-db`)
  - `SUNO_TOKEN` — secret
  - `BOT_TOKEN` — secret
  - `LINKS_KV` — KV namespace (`poetry-links`)
  - `PODCAST_KV` — KV namespace (`poetry-podcast`)
  - `TG_API` — secret
- **Features**:
  - `/api/songs` — получить список песен
  - `/api/song/{id}` — получить песню
  - `/api/song/{id}/podcasts` — подкасты песни
  - `/api/song/{id}/links` — ссылки песни
  - `/api/media/{id}` — прокси медиа
  - `/api/tg-file-url/{id}` — получить file_url из Telegram
  - `/api/register` — регистрация (admin)
  - `/api/login` — логин (admin)
  - `/api/admin/song` — CRUD песен (admin)

### CF D1 Database
- **Name**: `poetry-db`
- **Tables**: `songs`, `users` (+ maybe `links`, `podcasts`)

### CF KV
- `poetry-links` — ссылки на треки
- `poetry-podcast` — подкасты

### CF Cron Triggers
- `poetry-cron` — обновление данных

---

## 4. Migration Plan (to Yandex Cloud)

### Architecture
```
API Gateway (YC) → Cloud Functions (YC) → YDB (SQL) + Object Storage (S3) + Timer Trigger (cron)
```

### Step-by-step

#### 1. Создать сервисный аккаунт
```bash
yc iam service-account create --name poetry-bot
yc iam service-account add-access-binding poetry-bot \
  --role storage.editor --role ydb.editor --role functions.editor
yc iam key create --service-account-name poetry-bot -o key.json
```

#### 2. Создать YDB
```bash
yc ydb database create --name poetry-db \
  --serverless --serverless-timeout 5m \
  --service-account-id $(yc iam service-account get --name poetry-bot --format json | jq -r .id)
```

#### 3. Перенести API на Cloud Functions
- Перенести логику из CF Worker в Node.js Cloud Function
- Использовать YDB SDK вместо D1
- Хранить медиа-файлы в Object Storage S3

#### 4. Настроить API Gateway
- CORS
- Rate limiting
- Перенаправление с `poetry.shemax.workers.dev` (после настройки DNS)

#### 5. Перенести cron в Timer Trigger

#### 6. Настроить DNS/custom domain
- Купить/подключить домен к Yandex Cloud DNS
- Настроить CNAME на Object Storage для статики
- Настроить API Gateway domain

---

## 5. Local repo info

### Two local copies of frontend
| Path | Purpose |
|------|---------|
| `Shemaxpoetry/public/` | **Основная** — для Yandex Cloud (с CSP, OG, canonical) |
| `Poetry/public/` | Старая копия (без 3-экранного layout, старая вёрстка) |

### Editing commands
```bash
# Upload to YC
python3 upload_to_yc.py

# Check what's deployed
curl -sI "https://shemaxpoetry.website.yandexcloud.net/index.html"
curl -s "https://shemaxpoetry.website.yandexcloud.net/" | grep -c "main-logo"
```

---

## 6. Telegram
- **Канал**: https://t.me/shemaxpoetry
- **Bot token**: в CF secrets (`BOT_TOKEN`)
- **TG_API**: в CF secrets
