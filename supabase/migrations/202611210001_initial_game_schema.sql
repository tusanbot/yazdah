-- Initial PostgreSQL schema for Yazdah.
-- Apply with Supabase CLI: supabase db push
-- Monetary values are integer minor units (coins); never update balances outside the ledger RPCs.

create extension if not exists pgcrypto;

create table if not exists public.game_users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  username text,
  first_name text not null default '',
  last_name text,
  language_code text not null default 'fa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  country_code char(2),
  city text,
  founded_at date not null default current_date,
  level integer not null default 1 check (level between 1 and 100),
  reputation integer not null default 0 check (reputation >= 0),
  created_by uuid not null references public.game_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 2 and 60),
  check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$')
);

create table if not exists public.club_memberships (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.game_users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create unique index if not exists club_one_owner_per_user
  on public.club_memberships(user_id) where role = 'owner';

create table if not exists public.club_economy (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  balance bigint not null default 100000 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete set null,
  full_name text not null,
  birth_date date not null,
  nationality_code char(2),
  position text not null check (position in ('GK','CB','LB','RB','DM','CM','AM','LW','RW','ST')),
  overall integer not null default 40 check (overall between 1 and 100),
  potential integer not null default 60 check (potential between overall and 100),
  fitness integer not null default 100 check (fitness between 0 and 100),
  morale integer not null default 70 check (morale between 0 and 100),
  contract_until date,
  weekly_wage bigint not null default 0 check (weekly_wage >= 0),
  created_at timestamptz not null default now()
);
create index if not exists players_club_idx on public.players(club_id);

create table if not exists public.club_squad_slots (
  club_id uuid not null references public.clubs(id) on delete cascade,
  slot_no smallint not null check (slot_no between 1 and 11),
  player_id uuid not null unique references public.players(id),
  assigned_at timestamptz not null default now(),
  primary key (club_id, slot_no)
);

create table if not exists public.club_tactics (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  formation text not null default '4-3-3',
  mentality text not null default 'balanced' check (mentality in ('very_defensive','defensive','balanced','attacking','very_attacking')),
  tempo text not null default 'normal' check (tempo in ('slow','normal','fast')),
  pressing text not null default 'standard' check (pressing in ('low','standard','high')),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  full_name text not null,
  birth_date date not null,
  position text not null check (position in ('GK','CB','LB','RB','DM','CM','AM','LW','RW','ST')),
  potential integer not null check (potential between 1 and 100),
  development integer not null default 0 check (development >= 0),
  status text not null default 'training' check (status in ('training','promoted','released')),
  created_at timestamptz not null default now()
);
create index if not exists academy_club_idx on public.academy_players(club_id);

create table if not exists public.club_staff (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  full_name text not null,
  staff_role text not null check (staff_role in ('coach','technical','medical','fitness','transfer_director')),
  specialty text,
  skill integer not null default 40 check (skill between 1 and 100),
  weekly_wage bigint not null default 0 check (weekly_wage >= 0),
  contract_until date,
  hired_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists club_staff_active_idx on public.club_staff(club_id, staff_role) where released_at is null;

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  idempotency_key text not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now(),
  unique (club_id, idempotency_key)
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  memo text not null,
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_transaction_idx on public.ledger_entries(transaction_id);

-- Create a club and its starting records as one transaction.
-- Callable only by the trusted server using the service role; the API must verify Telegram identity first.
create or replace function public.create_club_for_user(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_logo_url text default null,
  p_country_code char(2) default null,
  p_city text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.game_users where id = p_user_id) then
    raise exception 'user_not_found' using errcode = '23503';
  end if;
  if exists (select 1 from public.club_memberships where user_id = p_user_id and role = 'owner') then
    raise exception 'user_already_owns_club' using errcode = '23505';
  end if;

  insert into public.clubs(name, slug, logo_url, country_code, city, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_logo_url, p_country_code, p_city, p_user_id)
  returning id into v_club_id;

  insert into public.club_memberships(club_id, user_id, role)
  values (v_club_id, p_user_id, 'owner');

  insert into public.club_economy(club_id, balance) values (v_club_id, 100000);
  insert into public.club_tactics(club_id) values (v_club_id);

  return v_club_id;
end;
$$;

revoke all on function public.create_club_for_user(uuid,text,text,text,char(2),text) from public, anon, authenticated;
grant execute on function public.create_club_for_user(uuid,text,text,text,char(2),text) to service_role;

-- The server is the sole writer at this stage. Browser clients must use the API,
-- never the Supabase service-role key or direct table writes.
alter table public.game_users enable row level security;
alter table public.clubs enable row level security;
alter table public.club_memberships enable row level security;
alter table public.club_economy enable row level security;
alter table public.players enable row level security;
alter table public.club_squad_slots enable row level security;
alter table public.club_tactics enable row level security;
alter table public.academy_players enable row level security;
alter table public.club_staff enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
