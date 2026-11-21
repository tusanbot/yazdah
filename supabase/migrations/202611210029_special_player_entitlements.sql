-- Trusted, one-time entitlement flow for special-player rewards.
-- Pack, tournament and event systems can issue entitlements through the service role;
-- clients can only claim an entitlement already assigned to their own club.

create table if not exists public.special_player_entitlements (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  catalog_player_id uuid not null references public.player_catalog(id) on delete restrict,
  source text not null check (source in ('epic_pack','legendary_pack','iconic_pack','tournament','special_event')),
  reference_id text not null check (char_length(trim(reference_id)) between 1 and 160),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 160),
  claimed_player_id uuid references public.players(id) on delete set null,
  issued_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (club_id, source, idempotency_key),
  check ((claimed_player_id is null and claimed_at is null)
      or (claimed_player_id is not null and claimed_at is not null))
);

create index if not exists special_player_entitlements_club_idx
  on public.special_player_entitlements(club_id, issued_at desc);

alter table public.special_player_entitlements enable row level security;

create or replace function public.issue_special_player_entitlement(
  p_club_id uuid,
  p_catalog_player_id uuid,
  p_source text,
  p_reference_id text,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement_id uuid;
  v_existing_catalog_id uuid;
  v_existing_reference_id text;
begin
  if p_club_id is null or p_catalog_player_id is null
    or p_source not in ('epic_pack','legendary_pack','iconic_pack','tournament','special_event')
    or p_reference_id is null or char_length(trim(p_reference_id)) not between 1 and 160
    or p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 160 then
    raise exception 'special_entitlement_input_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.player_catalog
    where id = p_catalog_player_id and active = true and player_class = 'special'
  ) then
    raise exception 'special_player_unavailable' using errcode = 'P0002';
  end if;

  insert into public.special_player_entitlements(
    club_id, catalog_player_id, source, reference_id, idempotency_key
  ) values (
    p_club_id, p_catalog_player_id, p_source, trim(p_reference_id), trim(p_idempotency_key)
  )
  on conflict (club_id, source, idempotency_key) do nothing
  returning id into v_entitlement_id;

  if v_entitlement_id is null then
    select id, catalog_player_id, reference_id
      into v_entitlement_id, v_existing_catalog_id, v_existing_reference_id
    from public.special_player_entitlements
    where club_id = p_club_id and source = p_source
      and idempotency_key = trim(p_idempotency_key);
    if v_existing_catalog_id <> p_catalog_player_id
      or v_existing_reference_id <> trim(p_reference_id) then
      raise exception 'special_entitlement_idempotency_conflict' using errcode = '23505';
    end if;
  end if;
  return v_entitlement_id;
end;
$$;

create or replace function public.claim_special_player_entitlement(
  p_user_id uuid,
  p_club_id uuid,
  p_entitlement_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement public.special_player_entitlements%rowtype;
  v_player_id uuid;
begin
  if p_user_id is null or p_club_id is null or p_entitlement_id is null then
    raise exception 'special_entitlement_claim_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.club_memberships
    where club_id = p_club_id and user_id = p_user_id and role = 'owner'
  ) then
    raise exception 'club_owner_required' using errcode = '42501';
  end if;

  select * into v_entitlement
  from public.special_player_entitlements
  where id = p_entitlement_id and club_id = p_club_id
  for update;

  if not found then
    raise exception 'special_entitlement_not_found' using errcode = 'P0002';
  end if;
  if v_entitlement.claimed_player_id is not null then
    return v_entitlement.claimed_player_id;
  end if;

  v_player_id := public.acquire_special_player(
    p_club_id,
    v_entitlement.catalog_player_id,
    v_entitlement.source,
    v_entitlement.reference_id
  );

  update public.special_player_entitlements
  set claimed_player_id = v_player_id, claimed_at = now()
  where id = v_entitlement.id;

  return v_player_id;
end;
$$;

revoke all on function public.issue_special_player_entitlement(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.issue_special_player_entitlement(uuid,uuid,text,text,text) to service_role;
revoke all on function public.claim_special_player_entitlement(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_special_player_entitlement(uuid,uuid,uuid) to service_role;
