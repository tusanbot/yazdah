-- Complete special-player pack purchasing and opening.
-- Pack offers are configured by trusted operators; client input never controls price or odds.

create table if not exists public.special_player_packs (
  pack_key text primary key check (pack_key in ('epic','legendary','iconic')),
  title text not null check (char_length(trim(title)) between 2 and 80),
  price bigint not null check (price > 0),
  active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.special_player_pack_openings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  pack_key text not null references public.special_player_packs(pack_key),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 160),
  player_id uuid not null references public.players(id) on delete restrict,
  charged_amount bigint not null check (charged_amount > 0),
  opened_at timestamptz not null default now(),
  unique (club_id, idempotency_key)
);
create index if not exists special_player_pack_openings_club_idx
  on public.special_player_pack_openings(club_id, opened_at desc);

alter table public.special_player_packs enable row level security;
alter table public.special_player_pack_openings enable row level security;

create or replace function public.open_special_player_pack(
  p_user_id uuid,
  p_club_id uuid,
  p_pack_key text,
  p_idempotency_key text
) returns table(opening_id uuid, player_id uuid, pack_key text, charged_amount bigint, balance bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pack public.special_player_packs%rowtype;
  v_player public.player_catalog%rowtype;
  v_opening_id uuid;
  v_player_id uuid;
  v_balance bigint;
  v_existing public.special_player_pack_openings%rowtype;
  v_source text;
begin
  if p_user_id is null or p_club_id is null
     or p_pack_key not in ('epic','legendary','iconic')
     or p_idempotency_key is null
     or char_length(trim(p_idempotency_key)) not between 1 and 160 then
    raise exception 'special_pack_input_invalid' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.club_memberships
    where club_id=p_club_id and user_id=p_user_id and role='owner'
  ) then raise exception 'club_owner_required' using errcode='42501'; end if;

  -- Serialize same-club purchases and make retries return the original draw.
  perform 1 from public.club_economy where club_id=p_club_id for update;
  if not found then raise exception 'club_economy_missing' using errcode='23503'; end if;

  select * into v_existing from public.special_player_pack_openings
  where club_id=p_club_id and idempotency_key=trim(p_idempotency_key);
  if found then
    if v_existing.pack_key <> p_pack_key then
      raise exception 'special_pack_idempotency_conflict' using errcode='23505';
    end if;
    select e.balance into v_balance from public.club_economy e where e.club_id=p_club_id;
    return query select v_existing.id,v_existing.player_id,v_existing.pack_key,v_existing.charged_amount,v_balance;
    return;
  end if;

  select * into v_pack from public.special_player_packs
  where pack_key=p_pack_key and active=true for share;
  if not found then raise exception 'special_pack_unavailable' using errcode='P0002'; end if;

  v_source := p_pack_key || '_pack';
  select * into v_player from public.player_catalog
  where active=true and player_class='special'
    and case p_pack_key
      when 'epic' then special_tier in ('star','legend','icon')
      when 'legendary' then special_tier in ('legend','icon')
      else special_tier='icon'
    end
  order by random()
  limit 1;
  if not found then raise exception 'special_pack_pool_empty' using errcode='P0002'; end if;

  -- Charge and draw are one transaction. Ledger's idempotency is derived from the request key.
  perform public.post_club_ledger(
    p_club_id,
    'special-pack:' || trim(p_idempotency_key),
    'special_pack_purchase',
    -v_pack.price,
    'Open ' || v_pack.title
  );

  v_player_id := public.acquire_special_player(
    p_club_id, v_player.id, v_source, trim(p_idempotency_key)
  );

  insert into public.special_player_pack_openings(
    club_id,pack_key,idempotency_key,player_id,charged_amount
  ) values (
    p_club_id,p_pack_key,trim(p_idempotency_key),v_player_id,v_pack.price
  ) returning id into v_opening_id;

  select e.balance into v_balance from public.club_economy e where e.club_id=p_club_id;
  return query select v_opening_id,v_player_id,p_pack_key,v_pack.price,v_balance;
end;
$$;

revoke all on function public.open_special_player_pack(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.open_special_player_pack(uuid,uuid,text,text) to service_role;

-- Only the trusted server/operator can publish or price packs.
revoke all on public.special_player_packs from public,anon,authenticated;
revoke all on public.special_player_pack_openings from public,anon,authenticated;
grant select,insert,update,delete on public.special_player_packs to service_role;
grant select,insert,update,delete on public.special_player_pack_openings to service_role;
