-- Academy recruitment operation. The API authenticates the owner before calling this service-role-only function.
create or replace function public.recruit_academy_player(
  p_club_id uuid,
  p_full_name text,
  p_birth_date date,
  p_position text,
  p_potential integer
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_club_id is null
    or p_full_name is null or char_length(trim(p_full_name)) not between 2 and 80
    or p_birth_date is null or p_birth_date >= current_date
    or p_birth_date < current_date - interval '23 years'
    or p_position not in ('GK','CB','LB','RB','DM','CM','AM','LW','RW','ST')
    or p_potential not between 1 and 100 then
    raise exception 'academy_input_invalid' using errcode = '22023';
  end if;

  insert into public.academy_players(club_id, full_name, birth_date, position, potential, development, status)
  values (p_club_id, trim(p_full_name), p_birth_date, p_position, p_potential, 0, 'training')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.recruit_academy_player(uuid,text,date,text,integer) from public, anon, authenticated;
grant execute on function public.recruit_academy_player(uuid,text,date,text,integer) to service_role;
