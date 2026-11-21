-- Durable, idempotent Telegram notifications for completed matches.
create table if not exists public.telegram_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  telegram_user_id bigint not null,
  message_text text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(match_id, telegram_user_id)
);
create index if not exists telegram_notification_outbox_pending_idx
  on public.telegram_notification_outbox(available_at, created_at)
  where status in ('pending','failed');
alter table public.telegram_notification_outbox enable row level security;

create or replace function public.enqueue_match_result_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_home_name text;
  v_away_name text;
  v_message text;
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;
  select name into v_home_name from public.clubs where id=new.home_club_id;
  select name into v_away_name from public.clubs where id=new.away_club_id;
  v_message := format(
    E'🏁 نتیجه مسابقه\n%s %s - %s %s\nشناسه مسابقه: %s',
    coalesce(v_home_name,'میزبان'), coalesce(new.home_score,0),
    coalesce(new.away_score,0), coalesce(v_away_name,'میهمان'), new.id
  );
  insert into public.telegram_notification_outbox(match_id,telegram_user_id,message_text)
  select new.id, gu.telegram_user_id, v_message
  from public.club_memberships cm
  join public.game_users gu on gu.id=cm.user_id
  where cm.role='owner'
    and cm.club_id in (new.home_club_id,new.away_club_id)
    and gu.telegram_user_id is not null
  on conflict(match_id,telegram_user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists matches_enqueue_result_notifications on public.matches;
create trigger matches_enqueue_result_notifications
after update of status on public.matches
for each row execute function public.enqueue_match_result_notifications();

create or replace function public.claim_telegram_notifications(p_limit integer default 20)
returns setof public.telegram_notification_outbox
language plpgsql security definer
set search_path=public,pg_temp
as $$
begin
  return query
  with picked as (
    select id from public.telegram_notification_outbox
    where (status in ('pending','failed') and available_at <= now())
       or (status='processing' and locked_at < now()-interval '5 minutes')
    order by created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.telegram_notification_outbox o
  set status='processing', locked_at=now(), attempts=attempts+1
  from picked where o.id=picked.id
  returning o.*;
end;
$$;
revoke all on function public.claim_telegram_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_telegram_notifications(integer) to service_role;
