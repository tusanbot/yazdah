-- Group treasury, auditable funding for free challenges, and idempotent prize settlement.

create table if not exists public.group_treasury_transactions (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null references public.telegram_game_groups(telegram_chat_id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(telegram_chat_id,idempotency_key)
);

-- Record the opening group treasury balance and keep future group creation auditable.
insert into public.group_treasury_transactions(telegram_chat_id,amount,balance_after,reason,idempotency_key)
select telegram_chat_id,100000,treasury_balance,'group_treasury_opening','opening'
from public.group_economies
on conflict(telegram_chat_id,idempotency_key) do nothing;

create or replace function public.ensure_group_economy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $
declare v_balance bigint;
begin
  insert into public.group_economies(telegram_chat_id) values(new.telegram_chat_id)
    on conflict do nothing;
  select treasury_balance into v_balance from public.group_economies where telegram_chat_id=new.telegram_chat_id;
  insert into public.group_treasury_transactions(telegram_chat_id,amount,balance_after,reason,idempotency_key)
    values(new.telegram_chat_id,100000,v_balance,'group_treasury_opening','opening')
    on conflict(telegram_chat_id,idempotency_key) do nothing;
  return new;
end;
$;

create or replace function public.create_group_game(
  p_chat_id bigint,p_creator_user_id uuid,p_game_type text,p_entry_fee bigint,p_max_participants integer,p_title text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_max integer; v_prize bigint:=0; v_balance bigint;
begin
  if p_game_type not in ('draft','penalty','cards','quiz','guess','survival')
     or p_entry_fee<0 or p_entry_fee>1000000 then
    raise exception 'group_game_input_invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.telegram_game_groups where telegram_chat_id=p_chat_id) then
    raise exception 'telegram_group_not_linked' using errcode='P0002';
  end if;
  v_max:=greatest(2,least(coalesce(p_max_participants,2),30));
  if p_game_type in ('draft','penalty','cards') then v_max:=2; end if;
  insert into public.group_games(telegram_chat_id,game_type,title,created_by_user_id,entry_fee,max_participants,prize_pool)
  values(p_chat_id,p_game_type,coalesce(nullif(trim(p_title),''),case p_game_type
    when 'draft' then 'چالش درفت' when 'penalty' then 'چالش پنالتی' when 'cards' then 'چالش کارت بازی'
    when 'quiz' then 'چالش اطلاعات فوتبالی' when 'guess' then 'چالش حدس بازیکن' else 'چالش بقا' end),
    p_creator_user_id,p_entry_fee,v_max,0)
  returning id into v_id;

  -- Free-entry games receive a 500-coin sponsored prize from the group's treasury when funds allow.
  if p_entry_fee=0 then
    update public.group_economies set treasury_balance=treasury_balance-500,updated_at=now()
      where telegram_chat_id=p_chat_id and treasury_balance>=500
      returning treasury_balance into v_balance;
    if found then
      v_prize:=500;
      insert into public.group_treasury_transactions(telegram_chat_id,amount,balance_after,reason,idempotency_key)
      values(p_chat_id,-500,v_balance,'free_group_challenge_prize',v_id::text||':sponsor');
      update public.group_games set prize_pool=v_prize,settings=jsonb_build_object('sponsoredPrize',true) where id=v_id;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.cancel_group_game(p_game_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $
declare g public.group_games%rowtype; p record; v_balance bigint; v_treasury bigint; v_refunded integer:=0;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found then raise exception 'group_game_not_found' using errcode='P0002'; end if;
  if g.created_by_user_id<>p_actor_user_id then raise exception 'group_game_creator_required' using errcode='42501'; end if;
  if g.status<>'open' then raise exception 'group_game_cannot_be_cancelled' using errcode='22023'; end if;

  if g.entry_fee>0 then
    for p in select user_id from public.group_game_participants where game_id=p_game_id loop
      v_balance:=public.group_wallet_change(g.telegram_chat_id,p.user_id,g.entry_fee,'challenge_entry_refund',
        p_game_id::text||':cancel-refund:'||p.user_id::text);
      v_refunded:=v_refunded+1;
    end loop;
  elsif coalesce((g.settings->>'sponsoredPrize')::boolean,false) and g.prize_pool>0 then
    update public.group_economies set treasury_balance=treasury_balance+g.prize_pool,updated_at=now()
      where telegram_chat_id=g.telegram_chat_id returning treasury_balance into v_treasury;
    insert into public.group_treasury_transactions(telegram_chat_id,amount,balance_after,reason,idempotency_key)
      values(g.telegram_chat_id,g.prize_pool,v_treasury,'cancelled_group_game_prize_refund',p_game_id::text||':cancel-treasury-refund')
      on conflict(telegram_chat_id,idempotency_key) do nothing;
  end if;

  update public.group_games set status='cancelled',deadline_at=null,completed_at=now(),
    state=state||jsonb_build_object('cancelledBy',p_actor_user_id,'cancelledAt',now())
    where id=p_game_id;
  return jsonb_build_object('cancelled',true,'refundedParticipants',v_refunded);
end;
$;

create or replace function public.settle_group_game_prize(p_game_id uuid,p_winners uuid[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.group_games%rowtype; v_count integer; v_share bigint; v_remainder bigint; v_user uuid; v_index integer:=0;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found or g.state->>'prizeSettled'='true' or g.prize_pool<=0 then return; end if;
  select count(distinct x) into v_count from unnest(coalesce(p_winners,'{}'::uuid[])) x where x is not null;
  if v_count=0 then
    update public.group_games set state=jsonb_set(state,'{prizeSettled}','true'::jsonb,true) where id=p_game_id;
    return;
  end if;
  v_share:=g.prize_pool/v_count;
  v_remainder:=g.prize_pool-(v_share*v_count);
  for v_user in select distinct x from unnest(p_winners) x where x is not null order by x loop
    v_index:=v_index+1;
    perform public.group_wallet_change(g.telegram_chat_id,v_user,v_share+case when v_index=1 then v_remainder else 0 end,
      'challenge_prize',p_game_id::text||':prize:'||v_user::text);
  end loop;
  update public.group_games set state=jsonb_set(state,'{prizeSettled}','true'::jsonb,true) where id=p_game_id;
end;
$$;

alter table public.group_treasury_transactions enable row level security;
revoke all on public.group_treasury_transactions from public,anon,authenticated;
revoke all on function public.settle_group_game_prize(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.settle_group_game_prize(uuid,uuid[]) to service_role;
revoke all on function public.cancel_group_game(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_group_game(uuid,uuid) to service_role;
revoke all on function public.create_group_game(bigint,uuid,text,bigint,integer,text) from public,anon,authenticated;
grant execute on function public.create_group_game(bigint,uuid,text,bigint,integer,text) to service_role;
