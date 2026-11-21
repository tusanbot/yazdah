-- Competition lifecycle: deterministic round-robin league schedules and knockout cups.
-- Apply after 202611210015_tactical_match_engine.sql. Server/worker only.

alter table public.matches add column if not exists competition_round integer not null default 1 check (competition_round > 0);
alter table public.competitions add column if not exists champion_club_id uuid references public.clubs(id) on delete set null;
alter table public.competitions add column if not exists completed_at timestamptz;

create index if not exists matches_competition_round_idx
  on public.matches(competition_id, competition_round, kickoff_at);

create or replace function public.create_competition_schedule(
  p_name text,
  p_type text,
  p_season integer,
  p_club_ids uuid[],
  p_first_kickoff timestamptz,
  p_match_interval_minutes integer default 10080
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_competition_id uuid;
  v_ids uuid[];
  v_count integer;
  v_round integer := 1;
  v_rounds integer;
  v_i integer;
  v_j integer;
  v_home uuid;
  v_away uuid;
  v_kickoff timestamptz;
  v_size integer;
  v_round_ids uuid[];
begin
  if p_name is null or length(trim(p_name)) not between 2 and 100
     or p_type not in ('league','cup')
     or p_season < 1
     or p_first_kickoff is null or p_first_kickoff <= now()
     or p_match_interval_minutes not between 60 and 100800 then
    raise exception 'competition_input_invalid' using errcode = '22023';
  end if;
  if p_club_ids is null or cardinality(p_club_ids) < 2
     or cardinality(p_club_ids) > 64
     or (select count(distinct x) from unnest(p_club_ids) x) <> cardinality(p_club_ids)
     or exists (select 1 from unnest(p_club_ids) x left join public.clubs c on c.id=x where c.id is null) then
    raise exception 'competition_clubs_invalid' using errcode = '22023';
  end if;
  v_ids := p_club_ids;
  v_count := cardinality(v_ids);

  if p_type = 'cup' and (v_count < 2 or (v_count & (v_count - 1)) <> 0) then
    raise exception 'cup_requires_power_of_two_clubs' using errcode = '22023';
  end if;

  insert into public.competitions(name, competition_type, season, status, starts_at)
  values (trim(p_name), p_type, p_season, 'scheduled', p_first_kickoff)
  returning id into v_competition_id;

  insert into public.competition_entries(competition_id, club_id, seed)
  select v_competition_id, x, ordinality::integer
  from unnest(v_ids) with ordinality as clubs(x, ordinality);

  if p_type = 'league' then
    -- Circle method: one round-robin cycle; each pair meets once.
    if v_count % 2 = 1 then
      v_ids := array_append(v_ids, null::uuid);
      v_count := v_count + 1;
    end if;
    v_rounds := v_count - 1;
    for v_round in 1..v_rounds loop
      v_kickoff := p_first_kickoff + ((v_round - 1) * p_match_interval_minutes * interval '1 minute');
      for v_i in 1..(v_count / 2) loop
        v_home := v_ids[v_i];
        v_away := v_ids[v_count - v_i + 1];
        if v_home is not null and v_away is not null then
          insert into public.matches(competition_id, home_club_id, away_club_id, kickoff_at, competition_round)
          values (v_competition_id, v_home, v_away, v_kickoff, v_round);
        end if;
      end loop;
      v_ids := array[v_ids[1]] || array[v_ids[v_count]] || v_ids[2:v_count-1];
    end loop;
  else
    v_size := v_count;
    v_rounds := 1;
    while v_size > 2 loop
      v_size := v_size / 2;
      v_rounds := v_rounds + 1;
    end loop;
    for v_i in 1..(v_count / 2) loop
      insert into public.matches(competition_id, home_club_id, away_club_id, kickoff_at, competition_round)
      values (v_competition_id, v_ids[v_i], v_ids[v_count - v_i + 1], p_first_kickoff, 1);
    end loop;
  end if;

  return v_competition_id;
end;
$$;

create or replace function public.advance_competition_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comp public.competitions%rowtype;
  v_remaining integer;
  v_next_round integer;
  v_winners uuid[];
  v_i integer;
begin
  if new.status <> 'completed' or old.status = 'completed' or new.competition_id is null then
    return new;
  end if;

  select * into v_comp from public.competitions where id = new.competition_id for update;
  if not found or v_comp.status in ('completed','cancelled') then return new; end if;

  if exists (
    select 1 from public.matches
    where competition_id = v_comp.id and competition_round = new.competition_round
      and status not in ('completed','cancelled')
  ) then
    update public.competitions set status='running' where id=v_comp.id and status='scheduled';
    return new;
  end if;

  if v_comp.competition_type = 'cup' then
    select array_agg(case when home_score > away_score then home_club_id else away_club_id end
                    order by kickoff_at, id)
      into v_winners
    from public.matches
    where competition_id=v_comp.id and competition_round=new.competition_round and status='completed';

    if cardinality(v_winners) = 1 then
      update public.competitions set status='completed', champion_club_id=v_winners[1], completed_at=now()
      where id=v_comp.id;
    elsif cardinality(v_winners) >= 2 then
      v_next_round := new.competition_round + 1;
      for v_i in 1..(cardinality(v_winners) / 2) loop
        insert into public.matches(competition_id, home_club_id, away_club_id, kickoff_at, competition_round)
        values (v_comp.id, v_winners[v_i*2-1], v_winners[v_i*2], now() + interval '1 day', v_next_round);
      end loop;
      update public.competitions set status='running' where id=v_comp.id;
    end if;
  else
    select count(*) into v_remaining from public.matches
    where competition_id=v_comp.id and status not in ('completed','cancelled');
    if v_remaining=0 then
      select club_id into v_comp.champion_club_id
      from public.competition_entries
      where competition_id=v_comp.id
      order by points desc, (goals_for-goals_against) desc, goals_for desc, club_id
      limit 1;
      update public.competitions set status='completed', champion_club_id=v_comp.champion_club_id, completed_at=now()
      where id=v_comp.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists matches_advance_competition_lifecycle on public.matches;
create trigger matches_advance_competition_lifecycle
after update of status on public.matches
for each row execute function public.advance_competition_lifecycle();

revoke all on function public.create_competition_schedule(text,text,integer,uuid[],timestamptz,integer) from public, anon, authenticated;
grant execute on function public.create_competition_schedule(text,text,integer,uuid[],timestamptz,integer) to service_role;
revoke all on function public.advance_competition_lifecycle() from public, anon, authenticated;
