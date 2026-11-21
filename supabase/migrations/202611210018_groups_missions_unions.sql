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

create or replace function public.create_club_union(p_club_id uuid,p_name text,p_tag text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_union_id uuid;
begin
 if exists(select 1 from public.club_union_members where club_id=p_club_id) then
   raise exception 'club_already_in_union' using errcode='23505';
 end if;
 insert into public.club_unions(name,tag,leader_club_id)
 values(trim(p_name),upper(trim(p_tag)),p_club_id) returning id into v_union_id;
 insert into public.club_union_members(union_id,club_id,role) values(v_union_id,p_club_id,'leader');
 return v_union_id;
end;
$$;
create or replace function public.join_club_union(p_club_id uuid,p_union_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.club_unions where id=p_union_id) then
   raise exception 'union_not_found' using errcode='P0002';
 end if;
 if exists(select 1 from public.club_union_members where club_id=p_club_id) then
   raise exception 'club_already_in_union' using errcode='23505';
 end if;
 if (select count(*) from public.club_union_members where union_id=p_union_id)>=20 then
   raise exception 'union_full' using errcode='22023';
 end if;
 insert into public.club_union_members(union_id,club_id,role) values(p_union_id,p_club_id,'member');
end;
$$;
create or replace function public.create_group_challenge(
 p_telegram_chat_id bigint,p_challenger_club_id uuid,p_opponent_club_id uuid,p_kickoff_at timestamptz
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_challenge_id uuid;
begin
 if p_challenger_club_id=p_opponent_club_id or p_kickoff_at<=now() then
   raise exception 'challenge_input_invalid' using errcode='22023';
 end if;
 if not exists(select 1 from public.telegram_game_groups where telegram_chat_id=p_telegram_chat_id) then
   raise exception 'telegram_group_not_linked' using errcode='P0002';
 end if;
 insert into public.group_challenges(telegram_chat_id,challenger_club_id,opponent_club_id)
 values(p_telegram_chat_id,p_challenger_club_id,p_opponent_club_id) returning id into v_challenge_id;
 return v_challenge_id;
end;
$$;
create or replace function public.accept_group_challenge(p_challenge_id uuid,p_opponent_club_id uuid,p_kickoff_at timestamptz)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_challenge public.group_challenges%rowtype; v_match_id uuid;
begin
 select * into v_challenge from public.group_challenges where id=p_challenge_id for update;
 if not found then raise exception 'challenge_not_found' using errcode='P0002'; end if;
 if v_challenge.status<>'pending' or v_challenge.opponent_club_id<>p_opponent_club_id then
   raise exception 'challenge_not_available' using errcode='22023';
 end if;
 if p_kickoff_at<=now() then raise exception 'challenge_kickoff_invalid' using errcode='22023'; end if;
 insert into public.matches(home_club_id,away_club_id,kickoff_at)
 values(v_challenge.challenger_club_id,v_challenge.opponent_club_id,p_kickoff_at)
 returning id into v_match_id;
 update public.group_challenges set status='accepted',match_id=v_match_id,accepted_at=now()
 where id=p_challenge_id;
 return v_match_id;
end;
$$;
revoke all on function public.create_club_union(uuid,text,text) from public,anon,authenticated;
revoke all on function public.join_club_union(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_group_challenge(bigint,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.accept_group_challenge(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.create_club_union(uuid,text,text) to service_role;
grant execute on function public.join_club_union(uuid,uuid) to service_role;
grant execute on function public.create_group_challenge(bigint,uuid,uuid,timestamptz) to service_role;
grant execute on function public.accept_group_challenge(uuid,uuid,timestamptz) to service_role;
