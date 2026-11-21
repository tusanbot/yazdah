-- Deterministic, atomic match resolution. Only the trusted server/worker may execute it.
-- Apply after 202611210007_transfer_market_operations.sql.

create or replace function public.resolve_match(
  p_match_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.matches%rowtype;
  v_home_rating numeric;
  v_away_rating numeric;
  v_home_seed bigint;
  v_away_seed bigint;
  v_home_score smallint;
  v_away_score smallint;
  v_result jsonb;
begin
  if p_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if v_match.status = 'completed' then
    return jsonb_build_object(
      'match_id', v_match.id,
      'status', v_match.status,
      'home_score', v_match.home_score,
      'away_score', v_match.away_score,
      'match_data', v_match.match_data
    );
  end if;

  if v_match.status <> 'scheduled' then
    raise exception 'match_not_resolvable' using errcode = '22023';
  end if;
  if v_match.kickoff_at > now() then
    raise exception 'match_not_started' using errcode = '22023';
  end if;

  select coalesce(avg(overall), 40) into v_home_rating
  from public.players where club_id = v_match.home_club_id;
  select coalesce(avg(overall), 40) into v_away_rating
  from public.players where club_id = v_match.away_club_id;

  -- Seeded from the immutable match UUID, so retries produce the same score.
  v_home_seed := (('x' || substr(md5(v_match.id::text || ':home'), 1, 7))::bit(32)::bigint) % 100;
  v_away_seed := (('x' || substr(md5(v_match.id::text || ':away'), 1, 7))::bit(32)::bigint) % 100;

  v_home_score := greatest(0, least(5,
    floor((v_home_rating + 4 - v_away_rating + 30) / 25)::integer
    + (v_home_seed % 3)::integer - 1
  ));
  v_away_score := greatest(0, least(5,
    floor((v_away_rating - v_home_rating + 30) / 25)::integer
    + (v_away_seed % 3)::integer - 1
  ));

  v_result := jsonb_build_object(
    'engine', 'yazdah-deterministic-v1',
    'home_rating', round(v_home_rating, 2),
    'away_rating', round(v_away_rating, 2),
    'home_seed', v_home_seed,
    'away_seed', v_away_seed,
    'resolved_at', now()
  );

  update public.matches
  set status = 'completed',
      home_score = v_home_score,
      away_score = v_away_score,
      match_data = coalesce(match_data, '{}'::jsonb) || v_result
  where id = v_match.id;

  if v_match.competition_id is not null then
    update public.competition_entries
    set played = played + 1,
        wins = wins + case when v_home_score > v_away_score then 1 else 0 end,
        draws = draws + case when v_home_score = v_away_score then 1 else 0 end,
        losses = losses + case when v_home_score < v_away_score then 1 else 0 end,
        points = points + case when v_home_score > v_away_score then 3 when v_home_score = v_away_score then 1 else 0 end,
        goals_for = goals_for + v_home_score,
        goals_against = goals_against + v_away_score
    where competition_id = v_match.competition_id and club_id = v_match.home_club_id;

    update public.competition_entries
    set played = played + 1,
        wins = wins + case when v_away_score > v_home_score then 1 else 0 end,
        draws = draws + case when v_away_score = v_home_score then 1 else 0 end,
        losses = losses + case when v_away_score < v_home_score then 1 else 0 end,
        points = points + case when v_away_score > v_home_score then 3 when v_away_score = v_home_score then 1 else 0 end,
        goals_for = goals_for + v_away_score,
        goals_against = goals_against + v_home_score
    where competition_id = v_match.competition_id and club_id = v_match.away_club_id;
  end if;

  return jsonb_build_object(
    'match_id', v_match.id,
    'status', 'completed',
    'home_score', v_home_score,
    'away_score', v_away_score,
    'match_data', v_result
  );
end;
$$;

revoke all on function public.resolve_match(uuid) from public, anon, authenticated;
grant execute on function public.resolve_match(uuid) to service_role;
