-- Competition completion awards: one configured special-player entitlement for the champion.
-- The competition lifecycle determines the champion; clients cannot nominate a recipient.

create table if not exists public.competition_special_player_rewards (
  competition_id uuid primary key references public.competitions(id) on delete cascade,
  catalog_player_id uuid not null references public.player_catalog(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.competition_special_player_awards (
  competition_id uuid primary key references public.competitions(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  catalog_player_id uuid not null references public.player_catalog(id) on delete restrict,
  entitlement_id uuid not null unique references public.special_player_entitlements(id) on delete restrict,
  awarded_at timestamptz not null default now()
);

alter table public.competition_special_player_rewards enable row level security;
alter table public.competition_special_player_awards enable row level security;
revoke all on public.competition_special_player_rewards from public,anon,authenticated;
revoke all on public.competition_special_player_awards from public,anon,authenticated;
grant select,insert,update,delete on public.competition_special_player_rewards to service_role;
grant select on public.competition_special_player_awards to service_role;

create or replace function public.issue_competition_special_player_award(p_competition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comp public.competitions%rowtype;
  v_catalog_id uuid;
  v_entitlement_id uuid;
  v_existing public.competition_special_player_awards%rowtype;
begin
  if p_competition_id is null then
    raise exception 'competition_id_required' using errcode='22023';
  end if;

  select * into v_comp from public.competitions where id=p_competition_id for update;
  if not found then raise exception 'competition_not_found' using errcode='P0002'; end if;
  if v_comp.status <> 'completed' or v_comp.champion_club_id is null then
    raise exception 'competition_not_awardable' using errcode='22023';
  end if;

  select * into v_existing from public.competition_special_player_awards
  where competition_id=p_competition_id;
  if found then return v_existing.entitlement_id; end if;

  select catalog_player_id into v_catalog_id
  from public.competition_special_player_rewards
  where competition_id=p_competition_id;
  if not found then raise exception 'competition_special_reward_not_configured' using errcode='P0002'; end if;

  v_entitlement_id:=public.issue_special_player_entitlement(
    v_comp.champion_club_id,
    v_catalog_id,
    case when v_comp.competition_type='tournament' then 'tournament' else 'special_event' end,
    'competition:'||v_comp.id::text,
    'competition-champion:'||v_comp.id::text
  );

  insert into public.competition_special_player_awards(
    competition_id,club_id,catalog_player_id,entitlement_id
  ) values (
    v_comp.id,v_comp.champion_club_id,v_catalog_id,v_entitlement_id
  ) on conflict(competition_id) do nothing;

  return v_entitlement_id;
end;
$$;

create or replace function public.award_completed_competition_special_player()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status='completed' and old.status is distinct from new.status
     and new.champion_club_id is not null
     and new.competition_type in ('tournament','cup','league') then
    perform public.issue_competition_special_player_award(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists competitions_special_player_award on public.competitions;
create trigger competitions_special_player_award
after update of status on public.competitions
for each row execute function public.award_completed_competition_special_player();

revoke all on function public.issue_competition_special_player_award(uuid) from public,anon,authenticated;
grant execute on function public.issue_competition_special_player_award(uuid) to service_role;
revoke all on function public.award_completed_competition_special_player() from public,anon,authenticated;
