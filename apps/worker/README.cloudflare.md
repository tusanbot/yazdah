# Cloudflare scheduled game processor (staging)

Target Worker: `football-empire-web-staging`. This service runs the game's scheduled jobs; it is not the Mini App frontend. The Mini App is a Next.js application and needs its own OpenNext/Cloudflare build pipeline before it can be hosted on a Worker.

Set Worker secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`

The one-minute Cron Trigger invokes a bounded batch (up to 10 game jobs) and is required for match resolution, daily payroll/training/sponsorship, expired group games, and Telegram notifications. Keep this trigger disabled until the staging database and service-role secret are verified. Do not configure an HTTP route for this processor.
