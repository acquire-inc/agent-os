-- Supabase-native scheduler using pg_cron.
-- Each enabled job gets a pg_cron entry that materializes a `scheduled` run at
-- its cron tick; triggers keep those entries in sync with the jobs table.
-- This is the Supabase deployment's scheduler — an alternative to the portable
-- apps/scheduler worker (use one or the other, not both, per database).

create extension if not exists pg_cron;

-- Stable pg_cron entry name for a job.
create or replace function aos_cron_name(p_job uuid)
  returns text language sql immutable
  as $$ select 'aos_job_' || p_job::text $$;

-- The command pg_cron runs at each tick: insert a scheduled run for the current
-- minute, unless one already exists for this job at that tick (idempotent).
create or replace function aos_job_cron_command(p_job uuid)
  returns text language sql stable
  as $$
    select format(
      $cmd$insert into runs (tenant_id, agent_id, job_id, status, trigger_source, scheduled_for)
           select j.tenant_id, j.agent_id, j.id, 'scheduled', 'schedule', date_trunc('minute', now())
           from jobs j
           where j.id = %L and j.enabled
             and not exists (
               select 1 from runs r
               where r.job_id = j.id and r.scheduled_for >= date_trunc('minute', now())
             );$cmd$,
      p_job
    );
  $$;

-- (Re)register a job's pg_cron entry. cron.schedule upserts by name.
create or replace function aos_schedule_job(p_job uuid, p_cron text)
  returns void language plpgsql security definer set search_path = public, cron, extensions
  as $$
  begin
    perform cron.schedule(aos_cron_name(p_job), p_cron, aos_job_cron_command(p_job));
  end;
  $$;

-- Remove a job's pg_cron entry (no error if it isn't scheduled).
create or replace function aos_unschedule_job(p_job uuid)
  returns void language plpgsql security definer set search_path = public, cron, extensions
  as $$
  begin
    perform cron.unschedule(aos_cron_name(p_job));
  exception when others then
    null;
  end;
  $$;

-- Keep pg_cron entries in lockstep with the jobs table.
create or replace function aos_sync_job_cron()
  returns trigger language plpgsql
  as $$
  begin
    if (tg_op = 'DELETE') then
      perform aos_unschedule_job(old.id);
      return old;
    end if;
    if (new.enabled) then
      perform aos_schedule_job(new.id, new.schedule_cron);
    else
      perform aos_unschedule_job(new.id);
    end if;
    return new;
  end;
  $$;

drop trigger if exists jobs_cron_sync on jobs;
create trigger jobs_cron_sync
  after insert or delete or update of schedule_cron, enabled, agent_id on jobs
  for each row execute function aos_sync_job_cron();

-- Backfill: schedule every currently-enabled job.
do $$
declare j record;
begin
  for j in select id, schedule_cron from jobs where enabled loop
    perform aos_schedule_job(j.id, j.schedule_cron);
  end loop;
end $$;
