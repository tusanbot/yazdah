-- Idempotent competition match prize settlement.
-- Apply after 202611210010_worker_scheduling.sql.

create or replace function public.settle_match_prizes(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.matches%rowtype;
  v_home_prize bigint;
  v_away_prize bigint;
begin
  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if v_match.status <> 'completed' then
    raise exception 'match_not_completed' using errcode = '22023';
  end if;
  if v_match.competition_id is null then
    return jsonb_build_object('match_id', p_match_id, 'settled', false, 'reason', 'friendly');
  end if;

  if v_match.home_score > v_match.away_score then
    v_home_prize := 2500; v_away_prize := 500;
  elsif v_match.home_score < v_match.away_score then
    v_home_prize := 500; v_away_prize := 2500;
  else
    v_home_prize := 1250; v_away_prize := 1250;
  end if;

  perform public.post_club_ledger(
    v_match.home_club_id,
    'match-prize:' || v_match.id::text || ':home',
    'competition_match_prize',
    v_home_prize,
    'Competition match prize'
  );
  perform public.post_club_ledger(
    v_match.away_club_id,
    'match-prize:' || v_match.id::text || ':away',
    'competition_match_prize',
    v_away_prize,
    'Competition match prize'
  );

  return jsonb_build_object(
    'match_id', v_match.id,
    'settled', true,
    'home_prize', v_home_prize,
    'away_prize', v_away_prize
  );
end;
$$;

revoke all on function public.settle_match_prizes(uuid) from public, anon, authenticated;
grant execute on function public.settle_match_prizes(uuid) to service_role;
