# Cloudflare Telegram Bot (staging)

Target Worker: `football-empire-bot-staging`. Webhook endpoint: `/telegram`; health endpoint: `/health`.

Set Worker secrets:
- `TELEGRAM_BOT_TOKEN`
- `BOT_INTERNAL_SECRET` (same value as the API Worker)
- `TELEGRAM_WEBHOOK_SECRET` (a new random secret; also use it when registering the Telegram webhook)

Set plain-text variables:
- `TELEGRAM_MINI_APP_URL`: staging Mini App origin
- `YAZDAH_API_URL`: staging API origin

The Worker validates Telegram's `X-Telegram-Bot-Api-Secret-Token` header. Register the webhook to `https://<worker-host>/telegram` with that secret token. Do not set a polling process or a Cron trigger.
