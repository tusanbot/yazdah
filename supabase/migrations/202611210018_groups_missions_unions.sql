-- Group challenges, club missions, and club unions.
-- Server-mediated writes only; Telegram group identifiers are not public auth tokens.

create table if not exists public.telegram_game_groups (
  telegram_chat_id bigint primary key,
  title text not null,
  linked_by_user_id uuid not null references public.game_users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.group_challenges (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  challenger_club_id uuid not null references public.clubs(id) on delete cascade,
  opponent_club_id uuid not null references public.clubs(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','completed','declined','expired')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (challenger_club_id <> opponent_club_id)
);
create index if not exists group_challenges_chat_recent_idx
  on public.group_challenges(telegram_chat_id, created_at desc);

create table if not exists public.mission_definitions (
  id text primary key,
  title text not null,
  description text not null,
  mission_type text not null check (mission_type in ('club_created','match_played','training_applied','player_promoted')),
  target_count integer not null default 1 check (target_count between 1 and 1000),
  reward_coins bigint not null check (reward_coins > 0),
  active boolean not null default true
);
create table if not exists public.club_mission_progress (
  club_id uuid not null references public.clubs(id) on delete cascade,
  mission_id text not null references public.mission_definitions(id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (club_id, mission_id)
);

create table if not exists public.club_unions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tag text not null unique,
  leader_club_id uuid not null references public.clubs(id),
  created_at timestamptz not null default now(),
  check (char_length(trim(name)) between 3 and 60),
  check (tag ~ '^[A-Z0-9]{2,6}$')
);
create table if not exists public.club_union_members (
  union_id uuid not null references public.club_unions(id) on delete cascade,
  club_id uuid not null unique references public.clubs(id) on delete cascade,
  role text not null default 'member' check (role in ('leader','member')),
  joined_at timestamptz not null default now(),
  primary key (union_id, club_id)
);

insert into public.mission_definitions(id,title,description,mission_type,target_count,reward_coins)
values
 ('play_first_match','اولین مسابقه','یک مسابقهٔ رسمی را به پایان برسان','match_played',1,3000),
 ('train_once','تمرین روزانه','یک نوبت تمرین باشگاه را اجرا کن','training_applied',1,1000),
 ('promote_youth','استعدادپروری','یک بازیکن آکادمی را به تیم اصلی ارتقا بده','player_promoted',1,2500)
on conflict (id) do nothing;

create or replace function public.claim_club_mission(p_club_id uuid,p_mission_id text)
returns bigint
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_reward bigint; v_target integer; v_progress integer; v_claimed timestamptz;
begin
 select reward_coins,target_count into v_reward,v_target from public.mission_definitions
 where id=p_mission_id and active=true;
 if not found then raise exception 'mission_unavailable' using errcode='P0002'; end if;
 select progress,claimed_at into v_progress,v_claimed from public.club_mission_progress
 where club_id=p_club_id and mission_id=p_mission_id for update;
 if not found or v_progress<v_target then raise exception 'mission_incomplete' using errcode='22023'; end if;
 if v_claimed is not null then raise exception 'mission_already_claimed' using errcode='23505'; end if;
 update public.club_mission_progress set claimed_at=now(),updated_at=now()
 where club_id=p_club_id and mission_id=p_mission_id;
 perform public.post_club_ledger(p_club_id,'mission-reward:'||p_mission_id,'mission_reward',v_reward,'Mission reward');
 return v_reward;
end;
$$;

revoke all on function public.claim_club_mission(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_club_mission(uuid,text) to service_role;

alter table public.telegram_game_groups enable row level security;
alter table public.group_challenges enable row level security;
alter table public.mission_definitions enable row level security;
alter table public.club_mission_progress enable row level security;
alter table public.club_unions enable row level security;
alter table public.club_union_members enable row level security;

-- Progress is event-driven and monotonic; repeat delivery is deduplicated by event key.
create table if not exists public.mission_progress_events (
  event_key text primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  mission_type text not null,
  created_at timestamptz not null default now()
);
alter table public.mission_progress_events enable row level security;

create or replace function public.record_mission_progress(p_club_id uuid,p_mission_type text,p_event_key text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_event_key is null or length(p_event_key) not between 1 and 200 then
    raise exception 'mission_event_key_invalid' using errcode='22023';
  end if;
  insert into public.mission_progress_events(event_key,club_id,mission_type)
  values(p_event_key,p_club_id,p_mission_type) on conflict do nothing;
  if not found then return; end if;
  insert into public.club_mission_progress(club_id,mission_id,progress)
  select p_club_id,id,1 from public.mission_definitions
  where mission_type=p_mission_type and active=true
  on conflict(club_id,mission_id) do update
    set progress=least(public.club_mission_progress.progress+1,1000000),updated_at=now()
    where public.club_mission_progress.claimed_at is null;
end;
$$;
revoke all on function public.record_mission_progress(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_mission_progress(uuid,text,text) to service_role;

create or replace function public.track_completed_match_missions()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    perform public.record_mission_progress(new.home_club_id,'match_played','match:'||new.id||':home');
    perform public.record_mission_progress(new.away_club_id,'match_played','match:'||new.id||':away');
  end if;
  return new;
end;
$$;
drop trigger if exists matches_track_mission_progress on public.matches;
create trigger matches_track_mission_progress after update of status on public.matches
for each row execute function public.track_completed_match_missions();
