-- Worker job leasing and retry lifecycle.
-- Apply after 202611210008_match_resolution.sql.

create or replace function public.claim_game_job(p_lease_seconds integer default 90)
returns setof public.game_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.game_jobs%rowtype;
begin
  if p_lease_seconds not between 10 and 900 then
    raise exception 'job_lease_invalid' using errcode = '22023';
  end if;

  select * into v_job
  from public.game_jobs
  where completed_at is null
    and run_at <= now()
    and (locked_at is null or locked_at < now() - make_interval(secs => p_lease_seconds))
    and attempts < 8
  order by run_at, created_at
  for update skip locked
  limit 1;

  if not found then return; end if;

  update public.game_jobs
  set locked_at = now(), attempts = attempts + 1
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.complete_game_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.game_jobs
  set completed_at = coalesce(completed_at, now()), locked_at = null, last_error = null
  where id = p_job_id and completed_at is null;
  return found;
end;
$$;

create or replace function public.fail_game_job(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts from public.game_jobs where id = p_job_id and completed_at is null for update;
  if not found then return false; end if;

  update public.game_jobs
  set locked_at = null,
      last_error = left(coalesce(p_error, 'worker_error'), 1000),
      run_at = case
        when v_attempts >= 8 then now() + interval '100 years'
        else now() + make_interval(secs => least(3600, 15 * power(2, greatest(0, v_attempts - 1))::integer))
      end
  where id = p_job_id;
  return true;
end;
$$;

revoke all on function public.claim_game_job(integer) from public, anon, authenticated;
revoke all on function public.complete_game_job(uuid) from public, anon, authenticated;
revoke all on function public.fail_game_job(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_game_job(integer) to service_role;
grant execute on function public.complete_game_job(uuid) to service_role;
grant execute on function public.fail_game_job(uuid,text) to service_role;
