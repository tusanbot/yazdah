-- Idempotent scheduling keys for recurring and match jobs.
-- Apply after 202611210009_worker_jobs.sql.

alter table public.game_jobs add column if not exists idempotency_key text;
create unique index if not exists game_jobs_idempotency_idx
  on public.game_jobs(idempotency_key) where idempotency_key is not null;
