-- Core gameplay infrastructure: transfers, competitions, matches, inbox and atomic club operations.
-- Apply after 202611210001_initial_game_schema.sql.
-- All writes are server-mediated through the service role and validated API sessions.

create table if not exists public.transfer_listings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null unique references public.players(id) on delete cascade,
  seller_club_id uuid not null references public.clubs(id) on delete cascade,
  asking_price bigint not null check (asking_price > 0),
  listed_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'listed' check (status in ('listed','sold','withdrawn','expired'))
);
create index if not exists transfer_listings_market_idx
  on public.transfer_listings(status, asking_price, listed_at);

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  competition_type text not null check (competition_type in ('league','cup','tournament','friendly')),
  season integer not null,
  status text not null default 'scheduled' check (status in ('scheduled','running','completed','cancelled')),
  starts_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.competition_entries (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  seed integer,
  points integer not null default 0,
  played integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  primary key (competition_id, club_id)
);
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid references public.competitions(id) on delete set null,
  home_club_id uuid not null references public.clubs(id),
  away_club_id uuid not null references public.clubs(id),
  kickoff_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','live','completed','cancelled')),
  home_score smallint check (home_score >= 0),
  away_score smallint check (away_score >= 0),
  match_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (home_club_id <> away_club_id)
);
create index if not exists matches_home_schedule_idx on public.matches(home_club_id, kickoff_at desc);
create index if not exists matches_away_schedule_idx on public.matches(away_club_id, kickoff_at desc);

create table if not exists public.game_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.game_users(id) on delete cascade,
  category text not null default 'system',
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists game_inbox_user_recent_idx on public.game_inbox(user_id, created_at desc);

create table if not exists public.game_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists game_jobs_ready_idx on public.game_jobs(run_at) where completed_at is null;

create table if not exists public.club_daily_state (
  club_id uuid not null references public.clubs(id) on delete cascade,
  state_date date not null,
  training_applied boolean not null default false,
  wages_applied boolean not null default false,
  daily_reward_claimed boolean not null default false,
  primary key (club_id, state_date)
);

-- A balanced ledger operation. Duplicate idempotency keys return the original transaction.
create or replace function public.post_club_ledger(
  p_club_id uuid,
  p_idempotency_key text,
  p_reason text,
  p_amount bigint,
  p_memo text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transaction_id uuid;
  v_balance bigint;
begin
  if p_club_id is null or p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 160
     or p_reason is null or length(trim(p_reason)) not between 1 and 80
     or p_amount = 0 or abs(p_amount) > 1000000000000 then
    raise exception 'ledger_input_invalid' using errcode = '22023';
  end if;

  insert into public.ledger_transactions(club_id, idempotency_key, reason)
  values (p_club_id, p_idempotency_key, p_reason)
  on conflict (club_id, idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id into v_transaction_id from public.ledger_transactions
    where club_id = p_club_id and idempotency_key = p_idempotency_key;
    return v_transaction_id;
  end if;

  select balance into v_balance from public.club_economy where club_id = p_club_id for update;
  if not found then
    raise exception 'club_economy_missing' using errcode = '23503';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'insufficient_funds' using errcode = '22023';
  end if;

  update public.club_economy
    set balance = balance + p_amount, updated_at = now()
    where club_id = p_club_id;

  insert into public.ledger_entries(transaction_id, amount, memo)
  values (v_transaction_id, p_amount, left(coalesce(p_memo, p_reason), 240));

  return v_transaction_id;
end;
$$;

-- Set the complete starting XI atomically; every player must belong to this club.
create or replace function public.set_club_lineup(
  p_club_id uuid,
  p_player_ids uuid[]
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_club_id is null or p_player_ids is null or cardinality(p_player_ids) <> 11
     or (select count(distinct x) from unnest(p_player_ids) x) <> 11 then
    raise exception 'lineup_requires_11_unique_players' using errcode = '22023';
  end if;
  if (select count(*) from public.players where club_id = p_club_id and id = any(p_player_ids)) <> 11 then
    raise exception 'lineup_player_not_owned' using errcode = '22023';
  end if;

  delete from public.club_squad_slots where club_id = p_club_id;
  insert into public.club_squad_slots(club_id, slot_no, player_id)
  select p_club_id, ordinality::smallint, player_id
  from unnest(p_player_ids) with ordinality as lineup(player_id, ordinality);
  return true;
end;
$$;

revoke all on function public.post_club_ledger(uuid,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.post_club_ledger(uuid,text,text,bigint,text) to service_role;
revoke all on function public.set_club_lineup(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.set_club_lineup(uuid,uuid[]) to service_role;

alter table public.transfer_listings enable row level security;
alter table public.competitions enable row level security;
alter table public.competition_entries enable row level security;
alter table public.matches enable row level security;
alter table public.game_inbox enable row level security;
alter table public.game_jobs enable row level security;
alter table public.club_daily_state enable row level security;
