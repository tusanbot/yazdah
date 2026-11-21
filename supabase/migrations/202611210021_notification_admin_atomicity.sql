-- Harden notification retries and make admin retry + audit atomic.
create or replace function public.claim_telegram_notifications(p_limit integer default 20)
returns setof public.telegram_notification_outbox
language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  return query
  with picked as (
    select id from public.telegram_notification_outbox
    where (status='pending' and available_at<=now())
       or (status='processing' and locked_at<now()-interval '5 minutes')
    order by created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.telegram_notification_outbox o
  set status='processing',locked_at=now(),attempts=attempts+1
  from picked where o.id=picked.id
  returning o.*;
end;
$$;
revoke all on function public.claim_telegram_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_telegram_notifications(integer) to service_role;

create or replace function public.admin_retry_telegram_notification(p_actor_user_id uuid,p_notification_id uuid)
returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v_updated_id uuid;
begin
  if not exists(select 1 from public.game_admins where user_id=p_actor_user_id) then
    raise exception 'admin_access_required' using errcode='42501';
  end if;
  update public.telegram_notification_outbox
  set status='pending',available_at=now(),locked_at=null,last_error=null
  where id=p_notification_id and status='failed'
  returning id into v_updated_id;
  if v_updated_id is null then return false; end if;
  insert into public.admin_audit_log(actor_user_id,action,target_type,target_id,details)
  values(p_actor_user_id,'notification.retry','telegram_notification',p_notification_id::text,'{}'::jsonb);
  return true;
end;
$$;
revoke all on function public.admin_retry_telegram_notification(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_retry_telegram_notification(uuid,uuid) to service_role;
