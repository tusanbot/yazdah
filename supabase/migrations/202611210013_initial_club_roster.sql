-- Complete club onboarding with an initial first-team roster.
-- Replaces the existing club creation RPC; no client or API contract changes.
create or replace function public.create_club_for_user(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_logo_url text default null,
  p_country_code char(2) default null,
  p_city text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.game_users where id = p_user_id) then
    raise exception 'user_not_found' using errcode = '23503';
  end if;
  if exists (select 1 from public.club_memberships where user_id = p_user_id and role = 'owner') then
    raise exception 'user_already_owns_club' using errcode = '23505';
  end if;

  insert into public.clubs(name, slug, logo_url, country_code, city, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_logo_url, p_country_code, p_city, p_user_id)
  returning id into v_club_id;

  insert into public.club_memberships(club_id, user_id, role)
  values (v_club_id, p_user_id, 'owner');
  insert into public.club_economy(club_id, balance) values (v_club_id, 100000);
  insert into public.club_tactics(club_id) values (v_club_id);

  -- Eighteen fictional players: a complete starting XI plus seven reserves.
  with roster(full_name, position, overall, potential, age_years) as (
    values
      ('آرمان نادری', 'GK', 58, 72, 27),
      ('سامان رستمی', 'CB', 57, 70, 25),
      ('پارسا زمانی', 'CB', 55, 73, 22),
      ('امیرحسین شریفی', 'LB', 54, 69, 24),
      ('کیان فرهمند', 'RB', 56, 71, 23),
      ('مهران توکلی', 'DM', 57, 72, 26),
      ('بردیا کریمی', 'CM', 58, 75, 21),
      ('یاسین بهرامی', 'AM', 59, 76, 22),
      ('نوید سلیمانی', 'LW', 56, 73, 20),
      ('ماهان اکبری', 'RW', 57, 74, 21),
      ('آریا محمدی', 'ST', 60, 77, 24),
      ('اشکان حیدری', 'GK', 49, 63, 20),
      ('شایان قاسمی', 'CB', 50, 66, 19),
      ('دانیال صادقی', 'LB', 49, 65, 21),
      ('سامیار یوسفی', 'RB', 50, 67, 20),
      ('پویان جعفری', 'CM', 51, 68, 19),
      ('رادین موسوی', 'LW', 50, 69, 18),
      ('امید نیک‌پی', 'ST', 52, 70, 20)
  ),
  inserted as (
    insert into public.players(
      club_id, full_name, birth_date, position, overall, potential,
      fitness, morale, contract_until, weekly_wage
    )
    select
      v_club_id, r.full_name,
      (current_date - make_interval(years => r.age_years))::date,
      r.position, r.overall, r.potential,
      100, 75, (current_date + interval '3 years')::date,
      greatest(100, r.overall * 25)
    from roster r
    returning id, overall
  ),
  starting_eleven as (
    select id, row_number() over (order by overall desc, id) as slot_no
    from inserted
  )
  insert into public.club_squad_slots(club_id, slot_no, player_id)
  select v_club_id, slot_no::smallint, id
  from starting_eleven
  where slot_no <= 11;

  return v_club_id;
end;
$$;

revoke all on function public.create_club_for_user(uuid,text,text,text,char(2),text) from public, anon, authenticated;
grant execute on function public.create_club_for_user(uuid,text,text,text,char(2),text) to service_role;
