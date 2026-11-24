-- Serialize duplicate wallet mutations by idempotency key to make retries exactly-once.
create or replace function public.group_wallet_change(
  p_chat_id bigint,p_user_id uuid,p_amount bigint,p_reason text,p_idempotency_key text
) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare v_balance bigint; v_existing bigint;
begin
  if p_amount=0 or p_idempotency_key is null or length(p_idempotency_key)=0 then
    raise exception 'group_wallet_change_input_invalid' using errcode='22023';
  end if;

  -- Serialize retries by idempotency key before touching the balance.
  perform pg_advisory_xact_lock(hashtext(p_chat_id::text||':'||p_idempotency_key));
  select balance_after into v_existing from public.group_currency_transactions
    where telegram_chat_id=p_chat_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  insert into public.group_wallets(telegram_chat_id,user_id,balance)
    values(p_chat_id,p_user_id,1000) on conflict do nothing;
  select balance into v_balance from public.group_wallets
    where telegram_chat_id=p_chat_id and user_id=p_user_id for update;
  if v_balance+p_amount<0 then
    raise exception 'group_wallet_insufficient' using errcode='22023';
  end if;

  v_balance:=v_balance+p_amount;
  update public.group_wallets set balance=v_balance,updated_at=now()
    where telegram_chat_id=p_chat_id and user_id=p_user_id;
  insert into public.group_currency_transactions(telegram_chat_id,user_id,amount,balance_after,reason,idempotency_key)
    values(p_chat_id,p_user_id,p_amount,v_balance,p_reason,p_idempotency_key);
  return v_balance;
end;
$$;

revoke all on function public.group_wallet_change(bigint,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.group_wallet_change(bigint,uuid,bigint,text,text) to service_role;
