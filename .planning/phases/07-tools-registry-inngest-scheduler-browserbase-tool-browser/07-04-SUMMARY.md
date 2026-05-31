---
plan: 07-04
phase: 7
status: complete
completed: 2026-05-30
requirements: [SC-7-2]
---
# Plan 07-04 Summary: Inngest Hono mount + pg_cron→Inngest bridge

## Built
- `apps/api/src/index.ts`: mount `serve as inngestServe` from `inngest/hono` at
  `/api/inngest` ABOVE the `/api/*` api-key middleware (Inngest authenticates via
  INNGEST_SIGNING_KEY, not the project bearer key).
- `apps/api/package.json`: added `inngest` + `@agent-os/inngest` deps.
- `supabase/migrations/0008_pg_cron_to_inngest.sql`: rewrites `aos_enqueue_due_runs()`
  to `net.http_post` an `agent/scheduled.run` event per due job at
  `{app.inngest_url}/api/inngest` instead of inlining `insert into runs`. pg_net
  extension + `aos_inngest_url()` GUC helper. Documented `ROLLBACK` block.
- `apps/api/src/app.test.ts`: `[inngest mount]` assertion — `/api/inngest` is not
  401 (proves it precedes auth), inside an INNGEST_DEV/SIGNING_KEY save-force-restore
  try/finally env contract.

## Deviation
Plan named the cron fn `aos_job_cron_command`; the real 0002 fn is the bulk
`aos_enqueue_due_runs()`. Rewrote the actual function, preserving its
`cron.schedule` registration (no backfill needed).

## Verification
12 packages typecheck; architect 33/33.

## Operator follow-ups
- `supabase db push` for 0008 (sandbox has no DB).
- Set `app.inngest_url` per deploy: `alter database postgres set app.inngest_url='https://<host>';`
- Live Inngest relay + INNGEST_SIGNING_KEY/EVENT_KEY to exercise cron→event→claim.
