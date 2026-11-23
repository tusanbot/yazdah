# Cloudflare API Worker (staging)

Target Worker: `football-empire-api-staging`.

The Worker entrypoint is `src/cloudflare.ts`; the existing Fastify routes are served through Fastify's `inject()` interface. Local Node startup remains `src/node.ts`.

Set these as **Worker secrets** in the Cloudflare dashboard (never commit values):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `SESSION_SECRET`
- `BOT_INTERNAL_SECRET`

Set `CORS_ORIGINS` as a plain-text variable to the exact staging Mini App origin. Replace the placeholder in wrangler.toml before deploy.

Deploy from this directory with Wrangler after installing workspace dependencies. Do not deploy until the API build/typecheck passes and the actual staging Mini App origin is configured.
