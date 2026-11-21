-- Tier-aware staff hiring and trusted special-player acquisition.
drop function if exists public.hire_club_staff(uuid,text,text,text,integer,bigint,date,text);

create or replace function public.hire_club_staff(
  p_club_id uuid,
  p_full_name text,
  p_staff_role text,
  p_specialty text,
  p_skill integer,
  p_weekly_wage bigint,
  p_contract_until date,
  p_idempotency_key text,
  p_staff_tier text default 'ordinary'
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id uuid;
  v_fee bigint;
  v_multiplier integer;
  v_effects jsonb;
begin
  if p_club_id is null
    or p_full_name is null or char_length(trim(p_full_name)) not between 2 and 80
    or p_staff_role not in ('head_coach','coach','technical','medical','fitness','transfer_director')
    or p_staff_tier not in ('ordinary','professional','legendary')
    or p_skill not between 1 and 100
    or p_weekly_wage not between 0 and 100000000
    or p_contract_until is null or p_contract_until <= current_date
    or p_contract_until > current_date + interval '5 years'
    or p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 160 then
    raise exception 'staff_input_invalid' using errcode = '22023';
  end if;

  v_multiplier := case p_staff_tier when 'ordinary' then 2 when 'professional' then 8 else 30 end;
  v_fee := p_weekly_wage * v_multiplier;
  v_effects := case p_staff_role
    when 'head_coach' then jsonb_build_object('match_tactics',p_skill/1000.0,'player_growth',p_skill/2000.0,'morale',p_skill/2500.0)
    when 'coach' then jsonb_build_object('player_growth',p_skill/1000.0)
    when 'technical' then jsonb_build_object('player_growth',p_skill/1500.0,'match_tactics',p_skill/3000.0)
    when 'medical' then jsonb_build_object('injury_recovery',p_skill/1000.0,'injury_risk_reduction',p_skill/1500.0)
    when 'fitness' then jsonb_build_object('fitness_recovery',p_skill/1000.0,'stamina',p_skill/2000.0)
    else jsonb_build_object('transfer_fee_discount',p_skill/2000.0,'scouting_quality',p_skill/1000.0)
  end;

  insert into public.club_staff(
    club_id,full_name,staff_role,staff_tier,specialty,skill,weekly_wage,
    signing_fee,contract_until,idempotency_key,effect_profile,generated_source
  ) values (
    p_club_id,trim(p_full_name),p_staff_role,p_staff_tier,
    nullif(trim(coalesce(p_specialty,'')),''),p_skill,p_weekly_wage,
    v_fee,p_contract_until,p_idempotency_key,v_effects,'manual'
  )
  on conflict (club_id,idempotency_key) where idempotency_key is not null do nothing
  returning id into v_staff_id;

  if v_staff_id is null then
    select id into v_staff_id from public.club_staff
    where club_id=p_club_id and idempotency_key=p_idempotency_key;
    return v_staff_id;
  end if;

  perform public.post_club_ledger(p_club_id,p_idempotency_key,'staff_signing',-v_fee,
    'Signing fee for ' || trim(p_full_name) || ' (' || p_staff_tier || ')');
  return v_staff_id;
end;
$$;

create or replace function public.acquire_special_player(
  p_club_id uuid,
  p_catalog_player_id uuid,
  p_source text,
  p_reference_id text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_catalog public.player_catalog%rowtype;
  v_player_id uuid;
begin
  if p_club_id is null or p_catalog_player_id is null
    or p_source not in ('epic_pack','legendary_pack','iconic_pack','tournament','special_event') then
    raise exception 'special_player_acquisition_invalid' using errcode = '22023';
  end if;
  select * into v_catalog from public.player_catalog
    where id=p_catalog_player_id and active=true and player_class='special' for share;
  if not found then raise exception 'special_player_unavailable' using errcode = 'P0002'; end if;

  insert into public.players(
    club_id,full_name,birth_date,nationality_code,position,overall,potential,
    fitness,morale,weekly_wage,player_class,ordinary_tier,release_clause,acquisition_source
  ) values (
    p_club_id,v_catalog.full_name,v_catalog.birth_date,v_catalog.nationality_code,
    v_catalog.position,v_catalog.overall,v_catalog.potential,100,75,
    v_catalog.weekly_wage,'special',null,v_catalog.release_clause,p_source
  ) returning id into v_player_id;

  insert into public.player_acquisition_log(player_id,club_id,source,reference_id)
  values(v_player_id,p_club_id,p_source,nullif(trim(coalesce(p_reference_id,'')),''));
  return v_player_id;
end;
$$;

revoke all on function public.hire_club_staff(uuid,text,text,text,integer,bigint,date,text,text) from public,anon,authenticated;
grant execute on function public.hire_club_staff(uuid,text,text,text,integer,bigint,date,text,text) to service_role;
revoke all on function public.acquire_special_player(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.acquire_special_player(uuid,uuid,text,text) to service_role;
