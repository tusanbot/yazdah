-- Daily sponsorship income and club finance ledger read API support.
alter table public.club_daily_state
  add column if not exists income_applied boolean not null default false;

create or replace function public.apply_daily_sponsorship(p_club_id uuid, p_state_date date)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_level integer;
  v_reputation integer;
  v_income bigint;
begin
  if p_club_id is null or p_state_date is null or p_state_date > current_date then
    raise exception 'sponsorship_input_invalid' using errcode='22023';
  end if;
  select level, reputation into v_level, v_reputation
  from public.clubs where id=p_club_id for update;
  if not found then raise exception 'club_not_found' using errcode='P0002'; end if;

  v_income := least(100000, 1500 + (v_level * 250)::bigint + (v_reputation * 2)::bigint);
  perform public.post_club_ledger(
    p_club_id,
    'sponsorship:' || p_state_date::text,
    'daily_sponsorship',
    v_income,
    'Daily sponsor revenue'
  );
  insert into public.club_daily_state(club_id,state_date,income_applied)
  values (p_club_id,p_state_date,true)
  on conflict (club_id,state_date) do update set income_applied=true;
  return v_income;
end;
$$;

revoke all on function public.apply_daily_sponsorship(uuid,date) from public, anon, authenticated;
grant execute on function public.apply_daily_sponsorship(uuid,date) to service_role;
