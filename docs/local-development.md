# Local setup

## Requirements

- Node.js 22 or newer
- pnpm 10
- A Supabase project (PostgreSQL)
- A Telegram bot token from BotFather

## Configure

Copy `.env.example` to the environment file used by your deployment and set:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the API server only.
- `TELEGRAM_BOT_TOKEN` and a high-entropy `SESSION_SECRET` on the API server.
- `CORS_ORIGINS` to a comma-separated allowlist of exact Mini App origins.
- `NEXT_PUBLIC_API_URL` to the API base URL when building the Mini App.

Never put the service-role key or bot token in any `NEXT_PUBLIC_*` variable or client bundle.

## Database

Apply `supabase/migrations/202611210001_initial_game_schema.sql` to the Supabase project using the Supabase SQL editor or the Supabase CLI migration workflow. The API expects the schema and `create_club_for_user` RPC to exist before club registration can work.

## Run

Install workspace dependencies with `pnpm install`, then run:

- `pnpm --filter @yazdah/api test`
- `pnpm --filter @yazdah/api typecheck`
- `pnpm --filter @yazdah/miniapp typecheck`
- `pnpm dev`

## Current API flow

1. The Mini App sends Telegram's raw `initData` to `POST /auth/telegram`.
2. The API validates the Telegram signature and freshness, then upserts the internal account.
3. The API returns a signed 15-minute bearer token.
4. The Mini App sends that token to `POST /clubs` to create the user's club.

The initial token is intentionally short-lived and held in Mini App memory. Persistent refresh sessions, bot-native account linking, and club profile editing are not implemented yet.
