# Cloudflare API Worker (staging)

Target Worker: `football-empire-api-staging`.

The Worker entrypoint is `src/cloudflare.ts`; the existing Fastify routes are served through Fastify's `inject()` interface. Local Node startup remains `src/node.ts`.

Set these as **Worker secrets** in the Cloudflare dashboard (never commit values):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `SESSION_SECRET`
- `BOT_INTERNAL_SECRET`

The staging Mini App origin is `https://football-empire-web-staging.mshmahyar9.workers.dev`; it is configured in `wrangler.toml` as `CORS_ORIGINS`.

The staging deployment workflow builds and deploys this Worker from the repository root. Do not deploy to the production Worker.
