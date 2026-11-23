# Mini App on Cloudflare

The Mini App is built with Next.js and adapted for Workers using `@opennextjs/cloudflare`. The staging target is `football-empire-web-staging`; its API origin is configured as `NEXT_PUBLIC_API_URL` in `wrangler.jsonc` and supplied at build time by the staging workflow.

The custom Worker entrypoint delegates HTTP requests to the generated OpenNext worker and scheduled events to the existing bounded game-job processor. This keeps the web app and one-minute game scheduler on the same staging Worker without overwriting the scheduler with a frontend-only script.

Run the `Deploy Cloudflare staging` GitHub Actions workflow manually after configuring the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The workflow builds first and only deploys when those credentials are available. Never use this workflow for production Workers.
