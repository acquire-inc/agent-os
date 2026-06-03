# Phase 24 — Inngest scheduled scorecard job

**Triggered by:** Phase 21 ships `runScorecardJob`; this phase ships the durable scheduler that runs it.
**Status:** complete

## Goal

Ship the Inngest function that walks active agents per tenant on a cron and invokes Phase 21's `runScorecardJob` — the missing link between scoring math and actual autonomy mutation.

## Delivered

- `packages/inngest/src/functions/scoreAgentsScheduled.ts` — Inngest function with two triggers:
  - `cron: "0 */6 * * *"` — every 6 hours sweep all `agents.lifecycleState='active'` rows
  - `event: "agent/score-now"` — ad-hoc per-agent rescoring (operator-triggered or workflow-chained)
- Builds a `ScorecardJobSink` over Drizzle:
  - `fetchRunSamples` joins `run_summaries.highlights` jsonb + `relay_events` cantfail count + per-agent `budgetCapUsd`
  - `persistScorecard` inserts into `agent_scorecards` (Phase 20 migration)
  - `applyAutonomy` calls Phase 21's `setAutonomy`
  - `markApplied` patches the scorecard row with `applied_at` + `applied_autonomy`
- 30-day rolling window
- One Inngest `step.run` per agent — bounded retry blast radius
- Concurrency capped at 3 to avoid stampede
- Exported from `@agent-os/inngest`
- Wired into `apps/api/src/index.ts` Inngest serve handler alongside `runScheduledAgent`

## Acceptance ✓

- `pnpm --filter @agent-os/inngest typecheck` clean
- `pnpm --filter @agent-os/api typecheck` clean

## Operator notes

- The function activates as soon as the api process picks up the new exports and the `pg_cron` / Inngest cloud config sees the new `cron` trigger
- Migration 0014 must be pushed first (agent_scorecards table)
- The function is idempotent at the autonomy level — re-running within the same window adds new scorecard rows but no autonomy mutation if `nextAutonomy === current`
