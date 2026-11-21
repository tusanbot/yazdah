-- Youth academy operations: promote a prospect atomically into the senior squad.
-- Apply after 202611210003_social_progression_operations.sql.

create or replace function public.promote_academy_player(
  p_club_id uuid,
  p_academy_player_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prospect public.academy_players%rowtype;
  v_player_id uuid;
begin
  if p_club_id is null or p_academy_player_id is null then
    raise exception 'academy_input_invalid' using errcode = '22023';
  end if;

  select * into v_prospect
  from public.academy_players
  where id = p_academy_player_id and club_id = p_club_id
  for update;

  if not found or v_prospect.status <> 'training' then
    raise exception 'academy_prospect_unavailable' using errcode = '22023';
  end if;

  insert into public.players (
    club_id, full_name, birth_date, position, overall, potential, fitness, morale
  ) values (
    p_club_id, v_prospect.full_name, v_prospect.birth_date, v_prospect.position,
    least(v_prospect.potential, 40 + least(v_prospect.development, 20)),
    v_prospect.potential, 100, 70
  ) returning id into v_player_id;

  update public.academy_players
  set status = 'promoted'
  where id = p_academy_player_id;

  return v_player_id;
end;
$$;

revoke all on function public.promote_academy_player(uuid,uuid) from public, anon, authenticated;
grant execute on function public.promote_academy_player(uuid,uuid) to service_role;
