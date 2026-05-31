-- 0008_pg_cron_to_inngest.sql
-- Bridge pg_cron -> Inngest (Phase 7, Plan 07-04).
--
-- Migration 0002 had each job's pg_cron tick inline `insert into runs`. This
-- rewrites the per-job command (aos_job_cron_command) to instead net.http_post an
-- `agent/scheduled.run` event to the Inngest webhook mounted at
-- {app.inngest_url}/api/inngest (apps/api). Inngest's runScheduledAgent function
-- (packages/inngest) then claims the due run durably (retryable + observable) —
-- the in-process insert is replaced by the durable orchestrator.
--
-- Pitfall 6 honored: hand-written SQL, no drizzle introspect.
-- Applies cleanly on any Postgres: pg_net guarded like pg_cron was in 0002.

-- pg_net provides net.http_post for outbound webhooks from Postgres (Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- Per-deploy Inngest base URL. Set with:
--   alter database postgres set app.inngest_url = 'https://api.acqu.inc';
-- Falls back to localhost for dev when the GUC is unset.
create or replace function aos_inngest_url()
  returns text language sql stable
  as $$
    select coalesce(
      nullif(current_setting('app.inngest_url', true), ''),
      'http://localhost:8787'
    );
  $$;

-- Rewrite the per-job tick command: POST an agent/scheduled.run event carrying
-- the job's tenant_id + agent_id. The event body matches runScheduledAgent's
-- expected shape: { name, data: { agentId, tenantId } }. Guarded so it is a
-- harmless no-op when pg_net is unavailable (mirrors 0002's pg_cron guard).
create or replace function aos_job_cron_command(p_job uuid)
  returns text language sql stable
  as $$
    select format(
      $cmd$select case when to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
                 then (select net.http_post(
                   url := %L,
                   body := jsonb_build_object(
                     'name', 'agent/scheduled.run',
                     'data', jsonb_build_object('agentId', j.agent_id, 'tenantId', j.tenant_id)
                   ),
                   headers := jsonb_build_object('content-type', 'application/json')
                 )::text from jobs j where j.id = %L and j.enabled)
                 else null end;$cmd$,
      aos_inngest_url() || '/api/inngest',
      p_job
    );
  $$;

-- Re-register every enabled job so live cron.job entries pick up the new command
-- (aos_schedule_job re-creates the cron entry with the rewritten command text).
do $$
declare j record;
begin
  for j in select id, schedule_cron from jobs where enabled loop
    perform aos_schedule_job(j.id, j.schedule_cron);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (per VALIDATION.md Nyquist dim 8):
--   Restore the original direct-insert command from 0002_pg_cron.sql lines 25-39
--   (verbatim aos_job_cron_command body that inlines `insert into runs ...`),
--   then re-run the backfill loop above to re-register jobs with the insert
--   command. Optionally `drop function aos_inngest_url();`. pg_net may remain
--   installed (harmless).
-- ----------------------------------------------------------------------------
