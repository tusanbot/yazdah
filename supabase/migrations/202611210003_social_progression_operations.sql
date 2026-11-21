-- Social, progression and operations infrastructure for the first playable release.
-- Apply after 202611210002_gameplay_infrastructure.sql.

create table if not exists public.telegram_groups (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null unique,
  title text not null,
  chat_type text not null check (chat_type in ('group','supergroup')),
  linked_by_user_id uuid not null references public.game_users(id),
  linked_club_id uuid not null references public.clubs(id),
  created_at timestamptz not null default now()
);

create table if not exists public.group_competitions (
  id uuid primary key default gen_random_uuid(),
  telegram_group_id uuid not null references public.telegram_groups(id) on delete cascade,
  title text not null,
  competition_type text not null check (competition_type in ('challenge','cup','league')),
  status text not null default 'open' check (status in ('open','running','completed','cancelled')),
  created_by_user_id uuid not null references public.game_users(id),
  starts_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.group_competition_entries (
  group_competition_id uuid not null references public.group_competitions(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  joined_by_user_id uuid not null references public.game_users(id),
  joined_at timestamptz not null default now(),
  primary key (group_competition_id, club_id)
);

create table if not exists public.unions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by_club_id uuid not null references public.clubs(id),
  created_at timestamptz not null default now()
);
create table if not exists public.union_memberships (
  union_id uuid not null references public.unions(id) on delete cascade,
  club_id uuid not null unique references public.clubs(id) on delete cascade,
  role text not null default 'member' check (role in ('leader','member')),
  joined_at timestamptz not null default now(),
  primary key (union_id, club_id)
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null,
  mission_type text not null check (mission_type in ('daily','weekly','seasonal','tutorial')),
  objective jsonb not null,
  reward jsonb not null,
  is_active boolean not null default true
);
create table if not exists public.user_missions (
  user_id uuid not null references public.game_users(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','completed','claimed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  claimed_at timestamptz,
  primary key (user_id, mission_id)
);

create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null,
  event_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rules jsonb not null default '{}'::jsonb,
  rewards jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  check (ends_at > starts_at)
);
create table if not exists public.user_event_progress (
  user_id uuid not null references public.game_users(id) on delete cascade,
  event_id uuid not null references public.game_events(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  reward_claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.game_users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('user','admin','worker','system')),
  action text not null,
  entity_type text,
  entity_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_recent_idx on public.audit_events(created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id, created_at desc);

alter table public.telegram_groups enable row level security;
alter table public.group_competitions enable row level security;
alter table public.group_competition_entries enable row level security;
alter table public.unions enable row level security;
alter table public.union_memberships enable row level security;
alter table public.missions enable row level security;
alter table public.user_missions enable row level security;
alter table public.game_events enable row level security;
alter table public.user_event_progress enable row level security;
alter table public.audit_events enable row level security;

-- Only trusted server code may append audit records; no client-facing table access is granted.
revoke all on public.audit_events from public, anon, authenticated;
