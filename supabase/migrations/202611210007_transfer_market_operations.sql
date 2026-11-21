-- Atomic transfer market operations: listing, purchase, withdrawal and ledger settlement.
-- Apply after 202611210006_staff_operations.sql.

alter table public.transfer_listings
  add column if not exists buyer_club_id uuid references public.clubs(id) on delete set null,
  add column if not exists sold_at timestamptz;

create or replace function public.list_player_for_transfer(
  p_club_id uuid,
  p_player_id uuid,
  p_asking_price bigint
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing_id uuid;
begin
  if p_club_id is null or p_player_id is null or p_asking_price is null
     or p_asking_price < 1 or p_asking_price > 1000000000000 then
    raise exception 'transfer_input_invalid' using errcode = '22023';
  end if;
  perform 1 from public.players where id = p_player_id and club_id = p_club_id for update;
  if not found then raise exception 'transfer_player_not_owned' using errcode = '22023'; end if;
  if exists (select 1 from public.transfer_listings where player_id = p_player_id and status = 'listed') then
    raise exception 'transfer_already_listed' using errcode = '23505';
  end if;
  delete from public.club_squad_slots where club_id = p_club_id and player_id = p_player_id;
  insert into public.transfer_listings(player_id, seller_club_id, asking_price, status)
  values (p_player_id, p_club_id, p_asking_price, 'listed')
  returning id into v_listing_id;
  return v_listing_id;
end;
$$;

create or replace function public.buy_transfer_listing(
  p_buyer_club_id uuid,
  p_listing_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing public.transfer_listings%rowtype;
  v_player_club_id uuid;
begin
  if p_buyer_club_id is null or p_listing_id is null then
    raise exception 'transfer_input_invalid' using errcode = '22023';
  end if;
  select * into v_listing from public.transfer_listings where id = p_listing_id for update;
  if not found then raise exception 'transfer_listing_not_found' using errcode = 'P0002'; end if;
  if v_listing.status = 'sold' and v_listing.buyer_club_id = p_buyer_club_id then return true; end if;
  if v_listing.status <> 'listed' or (v_listing.expires_at is not null and v_listing.expires_at <= now()) then
    raise exception 'transfer_listing_unavailable' using errcode = '22023';
  end if;
  if v_listing.seller_club_id = p_buyer_club_id then
    raise exception 'transfer_self_purchase' using errcode = '22023';
  end if;
  perform 1 from public.club_economy where club_id = p_buyer_club_id;
  if not found then raise exception 'buyer_club_economy_missing' using errcode = '23503'; end if;
  select club_id into v_player_club_id from public.players where id = v_listing.player_id for update;
  if v_player_club_id is distinct from v_listing.seller_club_id then
    raise exception 'transfer_player_state_invalid' using errcode = '22023';
  end if;

  perform public.post_club_ledger(
    p_buyer_club_id, 'transfer-buy:' || v_listing.id::text, 'transfer_purchase',
    -v_listing.asking_price, 'خرید بازیکن از بازار نقل‌وانتقالات'
  );
  perform public.post_club_ledger(
    v_listing.seller_club_id, 'transfer-sale:' || v_listing.id::text, 'transfer_sale',
    v_listing.asking_price, 'فروش بازیکن در بازار نقل‌وانتقالات'
  );
  update public.players set club_id = p_buyer_club_id where id = v_listing.player_id;
  update public.transfer_listings
    set status = 'sold', buyer_club_id = p_buyer_club_id, sold_at = now()
    where id = v_listing.id;
  return true;
end;
$$;

create or replace function public.withdraw_transfer_listing(
  p_club_id uuid,
  p_listing_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing public.transfer_listings%rowtype;
begin
  select * into v_listing from public.transfer_listings where id = p_listing_id for update;
  if not found then raise exception 'transfer_listing_not_found' using errcode = 'P0002'; end if;
  if v_listing.seller_club_id <> p_club_id then raise exception 'transfer_listing_not_owned' using errcode = '22023'; end if;
  if v_listing.status = 'withdrawn' then return true; end if;
  if v_listing.status <> 'listed' then raise exception 'transfer_listing_unavailable' using errcode = '22023'; end if;
  update public.transfer_listings set status = 'withdrawn' where id = v_listing.id;
  return true;
end;
$$;

revoke all on function public.list_player_for_transfer(uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.buy_transfer_listing(uuid,uuid) from public, anon, authenticated;
revoke all on function public.withdraw_transfer_listing(uuid,uuid) from public, anon, authenticated;
grant execute on function public.list_player_for_transfer(uuid,uuid,bigint) to service_role;
grant execute on function public.buy_transfer_listing(uuid,uuid) to service_role;
grant execute on function public.withdraw_transfer_listing(uuid,uuid) to service_role;
