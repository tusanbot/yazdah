-- Apply active staff tactical influence to match resolution with a bounded modifier.
create or replace function public.resolve_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match public.matches%rowtype;
  v_home_rating numeric;
  v_away_rating numeric;
  v_home_tactics public.club_tactics%rowtype;
  v_away_tactics public.club_tactics%rowtype;
  v_home_seed integer;
  v_away_seed integer;
  v_home_score smallint;
  v_away_score smallint;
  v_home_attack numeric := 0;
  v_away_attack numeric := 0;
  v_home_defense numeric := 0;
  v_away_defense numeric := 0;
  v_home_modifier numeric := 0;
  v_away_modifier numeric := 0;
  v_home_staff_effect numeric := 0;
  v_away_staff_effect numeric := 0;
  v_result jsonb;
begin
  if p_match_id is null then raise exception 'match_id_required' using errcode = '22023'; end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if v_match.status = 'completed' then
    return jsonb_build_object('match_id',v_match.id,'status',v_match.status,'home_score',v_match.home_score,'away_score',v_match.away_score,'match_data',v_match.match_data);
  end if;
  if v_match.status <> 'scheduled' then raise exception 'match_not_resolvable' using errcode = '22023'; end if;
  if v_match.kickoff_at > now() then raise exception 'match_not_started' using errcode = '22023'; end if;

  select coalesce(avg(p.overall * (0.75 + p.fitness / 400.0)),40)
    into v_home_rating
  from public.players p
  where p.club_id = v_match.home_club_id
    and (not exists(select 1 from public.club_squad_slots s where s.club_id=v_match.home_club_id)
         or exists(select 1 from public.club_squad_slots s where s.club_id=v_match.home_club_id and s.player_id=p.id));
  select coalesce(avg(p.overall * (0.75 + p.fitness / 400.0)),40)
    into v_away_rating
  from public.players p
  where p.club_id = v_match.away_club_id
    and (not exists(select 1 from public.club_squad_slots s where s.club_id=v_match.away_club_id)
         or exists(select 1 from public.club_squad_slots s where s.club_id=v_match.away_club_id and s.player_id=p.id));

  select * into v_home_tactics from public.club_tactics where club_id=v_match.home_club_id;
  select * into v_away_tactics from public.club_tactics where club_id=v_match.away_club_id;

  select least(1.5, coalesce(sum(greatest(0, coalesce((effect_profile->>'match_tactics')::numeric,0))),0) * 10)
    into v_home_staff_effect
  from public.club_staff
  where club_id=v_match.home_club_id and released_at is null
    and (contract_until is null or contract_until >= current_date);
  select least(1.5, coalesce(sum(greatest(0, coalesce((effect_profile->>'match_tactics')::numeric,0))),0) * 10)
    into v_away_staff_effect
  from public.club_staff
  where club_id=v_match.away_club_id and released_at is null
    and (contract_until is null or contract_until >= current_date);

  v_home_attack := case coalesce(v_home_tactics.mentality,'balanced')
    when 'very_attacking' then 0.65 when 'attacking' then 0.35 when 'defensive' then -0.25 when 'very_defensive' then -0.5 else 0 end;
  v_away_attack := case coalesce(v_away_tactics.mentality,'balanced')
    when 'very_attacking' then 0.65 when 'attacking' then 0.35 when 'defensive' then -0.25 when 'very_defensive' then -0.5 else 0 end;
  v_home_defense := case coalesce(v_home_tactics.mentality,'balanced')
    when 'very_attacking' then -0.45 when 'attacking' then -0.2 when 'defensive' then 0.3 when 'very_defensive' then 0.55 else 0 end;
  v_away_defense := case coalesce(v_away_tactics.mentality,'balanced')
    when 'very_attacking' then -0.45 when 'attacking' then -0.2 when 'defensive' then 0.3 when 'very_defensive' then 0.55 else 0 end;

  v_home_modifier := v_home_attack
    + case coalesce(v_home_tactics.tempo,'normal') when 'fast' then 0.2 when 'slow' then -0.1 else 0 end
    + case coalesce(v_home_tactics.pressing,'standard') when 'high' then 0.2 when 'low' then -0.1 else 0 end
    + case coalesce(v_home_tactics.formation,'4-3-3') when '3-5-2' then 0.12 when '4-2-3-1' then 0.08 when '5-3-2' then -0.08 else 0 end
    + v_home_staff_effect;
  v_away_modifier := v_away_attack
    + case coalesce(v_away_tactics.tempo,'normal') when 'fast' then 0.2 when 'slow' then -0.1 else 0 end
    + case coalesce(v_away_tactics.pressing,'standard') when 'high' then 0.2 when 'low' then -0.1 else 0 end
    + case coalesce(v_away_tactics.formation,'4-3-3') when '3-5-2' then 0.12 when '4-2-3-1' then 0.08 when '5-3-2' then -0.08 else 0 end
    + v_away_staff_effect;

  v_home_seed := (('x'||substr(md5(v_match.id::text||':home'),1,7))::bit(32)::bigint % 100)::integer;
  v_away_seed := (('x'||substr(md5(v_match.id::text||':away'),1,7))::bit(32)::bigint % 100)::integer;
  v_home_score := greatest(0,least(5,floor((v_home_rating-v_away_rating+6+v_home_modifier-v_away_defense)/12)::integer + (v_home_seed%3)-1));
  v_away_score := greatest(0,least(5,floor((v_away_rating-v_home_rating+v_away_modifier-v_home_defense)/12)::integer + (v_away_seed%3)-1));

  v_result := jsonb_build_object(
    'engine','yazdah-tactical-v3',
    'home_rating',round(v_home_rating,2),'away_rating',round(v_away_rating,2),
    'home_staff_tactical_effect',round(v_home_staff_effect,3),
    'away_staff_tactical_effect',round(v_away_staff_effect,3),
    'home_tactics',jsonb_build_object('formation',coalesce(v_home_tactics.formation,'4-3-3'),'mentality',coalesce(v_home_tactics.mentality,'balanced'),'tempo',coalesce(v_home_tactics.tempo,'normal'),'pressing',coalesce(v_home_tactics.pressing,'standard')),
    'away_tactics',jsonb_build_object('formation',coalesce(v_away_tactics.formation,'4-3-3'),'mentality',coalesce(v_away_tactics.mentality,'balanced'),'tempo',coalesce(v_away_tactics.tempo,'normal'),'pressing',coalesce(v_away_tactics.pressing,'standard')),
    'home_seed',v_home_seed,'away_seed',v_away_seed,'resolved_at',now()
  );
  update public.matches set status='completed',home_score=v_home_score,away_score=v_away_score,
    match_data=coalesce(match_data,'{}'::jsonb)||v_result where id=v_match.id;

  if v_match.competition_id is not null then
    update public.competition_entries set played=played+1,
      wins=wins+case when v_home_score>v_away_score then 1 else 0 end,
      draws=draws+case when v_home_score=v_away_score then 1 else 0 end,
      losses=losses+case when v_home_score<v_away_score then 1 else 0 end,
      points=points+case when v_home_score>v_away_score then 3 when v_home_score=v_away_score then 1 else 0 end,
      goals_for=goals_for+v_home_score,goals_against=goals_against+v_away_score
    where competition_id=v_match.competition_id and club_id=v_match.home_club_id;
    update public.competition_entries set played=played+1,
      wins=wins+case when v_away_score>v_home_score then 1 else 0 end,
      draws=draws+case when v_away_score=v_home_score then 1 else 0 end,
      losses=losses+case when v_away_score<v_home_score then 1 else 0 end,
      points=points+case when v_away_score>v_home_score then 3 when v_away_score=v_home_score then 1 else 0 end,
      goals_for=goals_for+v_away_score,goals_against=goals_against+v_home_score
    where competition_id=v_match.competition_id and club_id=v_match.away_club_id;
  end if;
  return jsonb_build_object('match_id',v_match.id,'status','completed','home_score',v_home_score,'away_score',v_away_score,'match_data',v_result);
end;
$$;
revoke all on function public.resolve_match(uuid) from public,anon,authenticated;
grant execute on function public.resolve_match(uuid) to service_role;
