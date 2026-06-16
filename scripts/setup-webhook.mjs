/**
 * Set up Telegram webhook.
 * Usage: TELEGRAM_BOT_TOKEN=xxx node scripts/setup-webhook.js https://your-site.pages.dev
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.argv[2];

if (!token || !url) {
  console.error('Usage: TELEGRAM_BOT_TOKEN=xxx node scripts/setup-webhook.js https://your-site.pages.dev');
  process.exit(1);
}

const webhookUrl = `${url.replace(/\/$/, '')}/api/webhook`;

fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    allowed_updates: ['message', 'channel_post'],
  }),
})
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      console.log('✓ Webhook set to:', webhookUrl);
    } else {
      console.error('✗ Failed:', data);
    }
  })
  .catch(err => console.error('✗ Error:', err));
