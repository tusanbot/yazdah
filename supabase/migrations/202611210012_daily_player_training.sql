-- Daily player training: bounded, idempotent development and fitness cost.
-- Applied by the trusted Worker once per club and UTC day.

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

  select count(*) into v_count
  from public.players
  where club_id = p_club_id and overall < potential;

  update public.players
  set overall = least(potential, overall + 1),
      fitness = greatest(0, fitness - 2)
  where club_id = p_club_id;

  update public.club_daily_state
  set training_applied = true
  where club_id = p_club_id and state_date = p_state_date;

  return v_count;
end;
$$;

revoke all on function public.apply_daily_training(uuid,date) from public, anon, authenticated;
grant execute on function public.apply_daily_training(uuid,date) to service_role;
