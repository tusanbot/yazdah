-- Player, staff and management progression model.
-- This migration extends the initial fictional roster without changing existing API contracts.
alter table public.players
  add column if not exists player_class text not null default 'ordinary'
    check (player_class in ('ordinary','professional','special')),
  add column if not exists ordinary_tier text
    check (ordinary_tier is null or ordinary_tier in ('base','prospect','elite')),
  add column if not exists release_clause bigint not null default 0 check (release_clause >= 0),
  add column if not exists acquisition_source text not null default 'club_generation'
    check (acquisition_source in ('club_generation','free_pool','transfer','epic_pack','legendary_pack','iconic_pack','tournament','special_event')),
  add column if not exists generated_for_club_id uuid references public.clubs(id) on delete set null;

alter table public.players drop constraint if exists players_ordinary_tier_class_check;
alter table public.players add constraint players_ordinary_tier_class_check
  check ((player_class = 'ordinary' and ordinary_tier is not null)
      or (player_class <> 'ordinary' and ordinary_tier is null));

create index if not exists players_free_pool_idx
  on public.players(generated_for_club_id, player_class, ordinary_tier)
  where club_id is null;

alter table public.club_staff
  add column if not exists staff_tier text not null default 'ordinary'
    check (staff_tier in ('ordinary','professional','legendary')),
  add column if not exists effect_profile jsonb not null default '{}'::jsonb,
  add column if not exists signing_fee bigint not null default 0 check (signing_fee >= 0),
  add column if not exists generated_source text not null default 'manual'
    check (generated_source in ('random_generation','real_world','manual'));

alter table public.club_staff drop constraint if exists club_staff_role_expanded_check;
alter table public.club_staff add constraint club_staff_role_expanded_check
  check (staff_role in ('head_coach','coach','technical','medical','fitness','transfer_director'));

create table if not exists public.player_catalog (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  birth_date date not null,
  nationality_code char(2),
  position text not null check (position in ('GK','CB','LB','RB','DM','CM','AM','LW','RW','ST')),
  player_class text not null check (player_class in ('professional','special')),
  special_tier text check (special_tier is null or special_tier in ('star','legend','icon')),
  overall integer not null check (overall between 1 and 100),
  potential integer not null check (potential between overall and 100),
  release_clause bigint not null check (release_clause > 0),
  weekly_wage bigint not null check (weekly_wage >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((player_class = 'professional' and special_tier is null)
      or (player_class = 'special' and special_tier is not null))
);
create unique index if not exists player_catalog_identity_idx
  on public.player_catalog(full_name, birth_date, player_class);

create table if not exists public.player_acquisition_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  source text not null check (source in ('epic_pack','legendary_pack','iconic_pack','tournament','special_event')),
  reference_id text,
  acquired_at timestamptz not null default now()
);
create index if not exists player_acquisition_club_idx
  on public.player_acquisition_log(club_id, acquired_at desc);

alter table public.player_acquisition_log enable row level security;
alter table public.player_catalog enable row level security;

-- Initial club generation is randomized and atomic: 18 contracted ordinary players,
-- five ordinary free agents scoped to this club's initial market, and a generated head coach.
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
  v_i integer;
  v_position text;
  v_tier text;
  v_overall integer;
  v_potential integer;
  v_age integer;
  v_name text;
  v_first_names text[] := array['آرمان','سامان','پارسا','امیرحسین','کیان','مهران','بردیا','یاسین','نوید','ماهان','آریا','اشکان','شایان','دانیال','سامیار','پویان','رادین','امید','سینا','طاها','سروش','بهنام','میلاد','عرفان','علی'];
  v_last_names text[] := array['نادری','رستمی','زمانی','شریفی','فرهمند','توکلی','کریمی','بهرامی','سلیمانی','اکبری','محمدی','حیدری','قاسمی','صادقی','یوسفی','جعفری','موسوی','نیک‌پی','رضایی','حسینی','کاظمی','مرادی','نوری','عباسی','صالحی'];
begin
  if p_user_id is null then raise exception 'user_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.game_users where id = p_user_id) then
    raise exception 'user_not_found' using errcode = '23503';
  end if;
  if exists (select 1 from public.club_memberships where user_id = p_user_id and role = 'owner') then
    raise exception 'user_already_owns_club' using errcode = '23505';
  end if;

  insert into public.clubs(name, slug, logo_url, country_code, city, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_logo_url, p_country_code, p_city, p_user_id)
  returning id into v_club_id;

  insert into public.club_memberships(club_id, user_id, role) values (v_club_id, p_user_id, 'owner');
  insert into public.club_economy(club_id, balance) values (v_club_id, 100000);
  insert into public.club_tactics(club_id) values (v_club_id);

  for v_i in 1..23 loop
    v_position := (array['GK','CB','LB','RB','DM','CM','AM','LW','RW','ST'])[1 + floor(random()*10)::int];
    v_tier := case when random() < 0.55 then 'base'
                   when random() < 0.86 then 'prospect' else 'elite' end;
    if v_tier = 'base' then
      v_overall := 38 + floor(random()*15)::int;
      v_potential := least(72, v_overall + 8 + floor(random()*17)::int);
    elsif v_tier = 'prospect' then
      v_overall := 48 + floor(random()*13)::int;
      v_potential := least(86, v_overall + 12 + floor(random()*19)::int);
    else
      v_overall := 58 + floor(random()*13)::int;
      v_potential := least(94, v_overall + 12 + floor(random()*18)::int);
    end if;
    v_age := case when v_i > 18 then 18 + floor(random()*12)::int else 18 + floor(random()*15)::int end;
    v_name := v_first_names[1 + floor(random()*array_length(v_first_names,1))::int] || ' ' ||
              v_last_names[1 + floor(random()*array_length(v_last_names,1))::int];

    insert into public.players(
      club_id, generated_for_club_id, full_name, birth_date, position,
      overall, potential, fitness, morale, contract_until, weekly_wage,
      player_class, ordinary_tier, release_clause, acquisition_source
    ) values (
      case when v_i <= 18 then v_club_id else null end,
      v_club_id, v_name, (current_date - make_interval(years => v_age))::date, v_position,
      v_overall, v_potential, 100, 75,
      case when v_i <= 18 then (current_date + interval '3 years')::date else null end,
      case when v_i <= 18 then greatest(100, v_overall * case v_tier when 'base' then 25 when 'prospect' then 55 else 110 end) else 0 end,
      'ordinary', v_tier,
      greatest(1000, v_overall * v_overall * case v_tier when 'base' then 20 else 35 end),
      case when v_i <= 18 then 'club_generation' else 'free_pool' end
    );
  end loop;

  insert into public.club_squad_slots(club_id, slot_no, player_id)
  select v_club_id, ranked.slot_no::smallint, ranked.id
  from (
    select id, row_number() over (order by overall desc, id) slot_no
    from public.players where club_id = v_club_id
  ) ranked where ranked.slot_no <= 11;

  insert into public.club_staff(
    club_id, full_name, staff_role, staff_tier, skill, weekly_wage,
    signing_fee, contract_until, generated_source, effect_profile
  ) values (
    v_club_id,
    v_first_names[1 + floor(random()*array_length(v_first_names,1))::int] || ' ' ||
      v_last_names[1 + floor(random()*array_length(v_last_names,1))::int],
    'head_coach','ordinary',35 + floor(random()*21)::int,500,1000,
    (current_date + interval '2 years')::date,'random_generation',
    jsonb_build_object('match_tactics',0.05,'player_growth',0.03,'morale',0.02)
  );

  return v_club_id;
end;
$$;

revoke all on function public.create_club_for_user(uuid,text,text,text,char(2),text) from public, anon, authenticated;
grant execute on function public.create_club_for_user(uuid,text,text,text,char(2),text) to service_role;
