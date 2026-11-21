-- Player contract renewal and configurable daily training plans.
create table if not exists public.club_training_preferences (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  plan text not null default 'balanced' check (plan in ('balanced','development','recovery')),
  updated_at timestamptz not null default now()
);
alter table public.club_training_preferences enable row level security;

create or replace function public.renew_player_contract(
  p_club_id uuid,
  p_player_id uuid,
  p_contract_until date,
  p_weekly_wage bigint
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_club_id is null or p_player_id is null or p_contract_until is null
     or p_contract_until <= current_date or p_contract_until > current_date + interval '5 years'
     or p_weekly_wage is null or p_weekly_wage < 0 or p_weekly_wage > 100000000 then
    raise exception 'player_contract_input_invalid' using errcode = '22023';
  end if;

  update public.players
  set contract_until = p_contract_until,
      weekly_wage = p_weekly_wage
  where id = p_player_id and club_id = p_club_id;

  if not found then
    raise exception 'player_not_owned' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_club_training_plan(
  p_club_id uuid,
  p_plan text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_club_id is null or p_plan not in ('balanced','development','recovery') then
    raise exception 'training_plan_invalid' using errcode = '22023';
  end if;
  insert into public.club_training_preferences(club_id, plan, updated_at)
  values (p_club_id, p_plan, now())
  on conflict (club_id) do update set plan = excluded.plan, updated_at = now();
  return p_plan;
end;
$$;

create or replace function public.apply_daily_training(
  p_club_id uuid,
  p_state_date date
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_applied boolean;
  v_count integer := 0;
  v_plan text := 'balanced';
begin
  if p_club_id is null or p_state_date is null then
    raise exception 'training_input_invalid' using errcode = '22023';
  end if;

  insert into public.club_daily_state(club_id, state_date)
  values (p_club_id, p_state_date)
  on conflict (club_id, state_date) do nothing;

  select training_applied into v_applied
  from public.club_daily_state
  where club_id = p_club_id and state_date = p_state_date
  for update;

  if v_applied then return 0; end if;

  select plan into v_plan
  from public.club_training_preferences where club_id = p_club_id;
  v_plan := coalesce(v_plan, 'balanced');

  if v_plan in ('balanced','development') then
    select count(*) into v_count
    from public.players
    where club_id = p_club_id and overall < potential;

    update public.players
    set overall = least(potential, overall + 1),
        fitness = greatest(0, fitness - case when v_plan = 'development' then 4 else 2 end)
    where club_id = p_club_id;
  else
    update public.players
    set fitness = least(100, fitness + 5)
    where club_id = p_club_id;
  end if;

  update public.club_daily_state
  set training_applied = true
  where club_id = p_club_id and state_date = p_state_date;

  return v_count;
end;
$$;

revoke all on function public.renew_player_contract(uuid,uuid,date,bigint) from public, anon, authenticated;
grant execute on function public.renew_player_contract(uuid,uuid,date,bigint) to service_role;
revoke all on function public.set_club_training_plan(uuid,text) from public, anon, authenticated;
grant execute on function public.set_club_training_plan(uuid,text) to service_role;
revoke all on function public.apply_daily_training(uuid,date) from public, anon, authenticated;
grant execute on function public.apply_daily_training(uuid,date) to service_role;
