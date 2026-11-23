# Cloudflare Telegram Bot (staging)

Target Worker: `football-empire-bot-staging`. Webhook endpoint: `/telegram`; health endpoints: `/` and `/health`.

Set Worker secrets:
- `TELEGRAM_BOT_TOKEN`
- `BOT_INTERNAL_SECRET` (same value as the API Worker)
- `TELEGRAM_WEBHOOK_SECRET` (also use it when registering the Telegram webhook)

Staging plain-text variables are configured in `wrangler.toml`:
- `TELEGRAM_MINI_APP_URL`: `https://football-empire-web-staging.mshmahyar9.workers.dev`
- `YAZDAH_API_URL`: `https://football-empire-api-staging.mshmahyar9.workers.dev`

The Worker validates Telegram's `X-Telegram-Bot-Api-Secret-Token` header. Register the webhook to `https://football-empire-bot-staging.mshmahyar9.workers.dev/telegram` with that secret token. Do not set a polling process or a Cron trigger.
