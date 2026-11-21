-- Apply active staff development and recovery effects to daily player training.
-- Staff effects are read only from active, in-contract staff profiles created by trusted server functions.

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
  v_growth_bonus integer := 0;
  v_recovery_bonus integer := 0;
  v_growth_factor numeric := 0;
  v_recovery_factor numeric := 0;
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

  if v_applied then
    return 0;
  end if;

  select
    coalesce(sum(greatest(0, coalesce((effect_profile->>'player_growth')::numeric, 0))), 0),
    coalesce(sum(greatest(0, coalesce((effect_profile->>'fitness_recovery')::numeric, 0))), 0)
  into v_growth_factor, v_recovery_factor
  from public.club_staff
  where club_id = p_club_id
    and released_at is null
    and (contract_until is null or contract_until >= p_state_date);

  -- Staff can add at most one extra overall point per daily session.
  -- Recovery staff can reduce the ordinary two-point fitness cost by at most one.
  v_growth_bonus := least(1, floor(least(0.2, v_growth_factor) * 5)::integer);
  v_recovery_bonus := least(1, floor(least(0.2, v_recovery_factor) * 5)::integer);

  select count(*) into v_count
  from public.players
  where club_id = p_club_id and overall < potential;

  update public.players
  set overall = least(potential, overall + 1 + v_growth_bonus),
      fitness = greatest(0, fitness - greatest(1, 2 - v_recovery_bonus))
  where club_id = p_club_id;

  update public.club_daily_state
  set training_applied = true
  where club_id = p_club_id and state_date = p_state_date;

  return v_count;
end;
$$;

revoke all on function public.apply_daily_training(uuid,date) from public, anon, authenticated;
grant execute on function public.apply_daily_training(uuid,date) to service_role;
