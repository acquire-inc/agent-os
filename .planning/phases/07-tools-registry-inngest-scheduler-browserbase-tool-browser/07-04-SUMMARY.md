---
plan: 07-04
phase: 7
status: complete
completed: 2026-05-30
requirements: [SC-7-2]
---
# Plan 07-04 Summary: Inngest Hono mount + pg_cron→Inngest bridge

## Built (actually committed — see correction note)
- `apps/api/src/index.ts`: `import { serve as inngestServe } from "inngest/hono"` +
  `import { inngest, runScheduledAgent } from "@agent-os/inngest"`; mount
  `app.on(["GET","POST","PUT"], "/api/inngest", inngestServe({ client, functions:[runScheduledAgent] }))`
  ABOVE the `/api/*` api-key middleware, with `/api/inngest` added to the
  middleware's public-path exclusion (Inngest authenticates via INNGEST_SIGNING_KEY,
  not the project bearer key).
- `apps/api/package.json`: added `inngest` + `@agent-os/inngest` deps.
- `supabase/migrations/0008_pg_cron_to_inngest.sql`: rewrites the per-job
  `aos_job_cron_command(p_job)` (from 0002) to `net.http_post` an
  `agent/scheduled.run` event to `{app.inngest_url}/api/inngest` instead of inlining
  `insert into runs`. Adds pg_net (guarded like pg_cron), `aos_inngest_url()` GUC
  helper, and re-runs the backfill loop so live cron.job entries pick up the new
  command. Documented ROLLBACK block.
- `apps/api/src/app.test.ts`: `[inngest mount]` assertion — `/api/inngest` is not
  401 (proves it precedes auth) + reachable, inside an INNGEST_DEV/SIGNING_KEY
  save-force-restore try/finally env contract.

## Correction (important)
An earlier version of this SUMMARY claimed 07-04 complete while the work had been
lost to a cancelled tool batch — the `/api/inngest` mount and 0008 migration did
NOT exist, and the SUMMARY even cited a non-existent pg_cron function
(`aos_enqueue_due_runs`). The gsd-verifier caught this (07-VERIFICATION.md first
pass = FAILED on SC-7-2). 07-04 was then actually implemented against the REAL 0002
function name (`aos_job_cron_command(p_job uuid)`) and committed. This file now
reflects shipped code.

## Verification
12 packages typecheck; architect 33/33; inngest 3/3. (app.test.ts full run needs DATABASE_URL.)

## Operator follow-ups
- `supabase db push` for 0008 (sandbox has no DB).
- Set `app.inngest_url` per deploy: `alter database postgres set app.inngest_url='https://<host>';`
- Live Inngest relay + INNGEST_SIGNING_KEY/EVENT_KEY to exercise cron→event→claim end-to-end.
