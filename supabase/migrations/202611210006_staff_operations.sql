-- Staff operations: hiring charges a one-time signing fee atomically with the staff record.
-- Release is idempotent and stops future wage accrual; payroll processing is handled by the scheduled worker.
create or replace function public.hire_club_staff(
  p_club_id uuid,
  p_full_name text,
  p_staff_role text,
  p_specialty text,
  p_skill integer,
  p_weekly_wage bigint,
  p_contract_until date,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id uuid;
  v_fee bigint;
begin
  if p_club_id is null
    or p_full_name is null or char_length(trim(p_full_name)) not between 2 and 80
    or p_staff_role not in ('coach','technical','medical','fitness','transfer_director')
    or p_skill not between 1 and 100
    or p_weekly_wage not between 0 and 100000000
    or p_contract_until is null or p_contract_until <= current_date
    or p_contract_until > current_date + interval '5 years'
    or p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 160 then
    raise exception 'staff_input_invalid' using errcode = '22023';
  end if;

  v_fee := p_weekly_wage * 2;
  perform public.post_club_ledger(p_club_id, p_idempotency_key, 'staff_signing', -v_fee,
    'Signing fee for ' || trim(p_full_name));

  insert into public.club_staff(club_id, full_name, staff_role, specialty, skill, weekly_wage, contract_until)
  values (p_club_id, trim(p_full_name), p_staff_role, nullif(trim(coalesce(p_specialty,'')),''), p_skill, p_weekly_wage, p_contract_until)
  returning id into v_staff_id;
  return v_staff_id;
end;
$$;

create or replace function public.release_club_staff(p_club_id uuid, p_staff_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.club_staff set released_at = now()
  where id = p_staff_id and club_id = p_club_id and released_at is null;
  return found;
end;
$$;

revoke all on function public.hire_club_staff(uuid,text,text,text,integer,bigint,date,text) from public, anon, authenticated;
revoke all on function public.release_club_staff(uuid,uuid) from public, anon, authenticated;
grant execute on function public.hire_club_staff(uuid,text,text,text,integer,bigint,date,text) to service_role;
grant execute on function public.release_club_staff(uuid,uuid) to service_role;
