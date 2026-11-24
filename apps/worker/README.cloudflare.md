# Scheduled game processor (staging)

The processor's bounded scheduled batch is imported by `apps/miniapp/cloudflare-worker.mjs` and runs on the `football-empire-web-staging` Worker Cron Trigger. This avoids replacing the web Worker with a separate script and keeps the requested staging Worker set to API, bot, and web.

`apps/worker/wrangler.toml` retains a separate `football-empire-jobs-staging` configuration for a future standalone deployment. Do not deploy that configuration while the web Worker is invoking the same scheduled batch, or the scheduler would run twice.

Required Worker secrets on the combined web Worker:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`

The one-minute Cron Trigger runs a bounded batch (up to 10 game jobs), including match resolution, daily payroll/training/sponsorship, expired group games, and Telegram notifications.
