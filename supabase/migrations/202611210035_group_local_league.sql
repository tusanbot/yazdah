-- Optional Telegram-group local league: admin-controlled registration and atomic schedule creation.
create table if not exists public.group_local_leagues (
  telegram_chat_id bigint primary key references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  enabled boolean not null default false,
  activated_by_user_id uuid references public.game_users(id) on delete set null,
  activated_at timestamptz,
  competition_id uuid unique references public.competitions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_local_league_entries (
  telegram_chat_id bigint not null references public.group_local_leagues(telegram_chat_id) on delete cascade,
  user_id uuid not null references public.game_users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (telegram_chat_id,user_id),
  unique (telegram_chat_id,club_id)
);

create or replace function public.activate_group_local_league(p_chat_id bigint,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare v_league public.group_local_leagues%rowtype;
begin
  insert into public.group_local_leagues(telegram_chat_id,enabled,activated_by_user_id,activated_at)
    values(p_chat_id,true,p_actor_user_id,now()) on conflict(telegram_chat_id) do nothing;
  select * into v_league from public.group_local_leagues
    where telegram_chat_id=p_chat_id for update;
  if v_league.competition_id is not null then
    raise exception 'local_league_already_started' using errcode='23505';
  end if;
  update public.group_local_leagues set enabled=true,activated_by_user_id=p_actor_user_id,activated_at=now()
    where telegram_chat_id=p_chat_id;
  return jsonb_build_object('enabled',true,'competitionId',null);
end;
$$;

create or replace function public.join_group_local_league(p_chat_id bigint,p_user_id uuid,p_club_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare v_league public.group_local_leagues%rowtype; v_count integer;
begin
  select * into v_league from public.group_local_leagues
    where telegram_chat_id=p_chat_id for update;
  if not found then raise exception 'local_league_not_configured' using errcode='P0002'; end if;
  if not v_league.enabled or v_league.competition_id is not null then
    raise exception 'local_league_registration_closed' using errcode='22023';
  end if;
  if not exists(select 1 from public.club_memberships
    where club_id=p_club_id and user_id=p_user_id and role='owner') then
    raise exception 'local_league_club_not_owned' using errcode='42501';
  end if;
  select count(*) into v_count from public.group_local_league_entries where telegram_chat_id=p_chat_id;
  if v_count>=64 then raise exception 'local_league_full' using errcode='22023'; end if;
  insert into public.group_local_league_entries(telegram_chat_id,user_id,club_id)
    values(p_chat_id,p_user_id,p_club_id);
  return jsonb_build_object('joined',true,'userId',p_user_id,'clubId',p_club_id);
end;
$$;

create or replace function public.start_group_local_league(p_chat_id bigint)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_league public.group_local_leagues%rowtype;
  v_title text;
  v_clubs uuid[];
  v_count integer;
  v_competition_id uuid;
begin
  select * into v_league from public.group_local_leagues
    where telegram_chat_id=p_chat_id for update;
  if not found then raise exception 'local_league_not_configured' using errcode='P0002'; end if;
  if not v_league.enabled then raise exception 'local_league_disabled' using errcode='22023'; end if;
  if v_league.competition_id is not null then
    raise exception 'local_league_already_started' using errcode='23505';
  end if;

  select array_agg(club_id order by joined_at),count(*) into v_clubs,v_count
    from public.group_local_league_entries where telegram_chat_id=p_chat_id;
  if coalesce(v_count,0)<2 then
    raise exception 'local_league_needs_two_clubs' using errcode='22023';
  end if;

  select coalesce(nullif(trim(title),''),'گروه تلگرام') into v_title
    from public.telegram_game_groups where telegram_chat_id=p_chat_id;
  v_competition_id:=public.create_competition_schedule(
    left('لیگ محلی '||coalesce(v_title,'یازده'),100),
    'league',
    extract(year from now())::integer,
    v_clubs,
    now()+interval '1 day',
    10080
  );
  update public.group_local_leagues set competition_id=v_competition_id
    where telegram_chat_id=p_chat_id;
  return v_competition_id;
end;
$$;

alter table public.group_local_leagues enable row level security;
alter table public.group_local_league_entries enable row level security;
revoke all on public.group_local_leagues from public,anon,authenticated;
revoke all on public.group_local_league_entries from public,anon,authenticated;
revoke all on function public.activate_group_local_league(bigint,uuid) from public,anon,authenticated;
grant execute on function public.activate_group_local_league(bigint,uuid) to service_role;
revoke all on function public.join_group_local_league(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.join_group_local_league(bigint,uuid,uuid) to service_role;
revoke all on function public.start_group_local_league(bigint) from public,anon,authenticated;
grant execute on function public.start_group_local_league(bigint) to service_role;
