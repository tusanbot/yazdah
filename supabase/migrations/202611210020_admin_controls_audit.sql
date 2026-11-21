-- Explicitly provisioned administrator access and auditable operational controls.
create table if not exists public.game_admins (
  user_id uuid primary key references public.game_users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin','super_admin')),
  created_at timestamptz not null default now(),
  created_by uuid references public.game_users(id)
);
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.game_users(id),
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_recent_idx on public.admin_audit_log(created_at desc);
alter table public.game_admins enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.game_admins, public.admin_audit_log from anon, authenticated;
grant select, insert on public.admin_audit_log to service_role;
grant select on public.game_admins to service_role;
