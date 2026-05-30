---
plan: 07-03
phase: 7
status: complete
completed: 2026-05-30
tasks_completed: 4
tasks_total: 4
commits: 1
requirements: [SC-7-2]
---

# Plan 07-03 Summary: @agent-os/inngest package

## What Was Built

The `@agent-os/inngest` workspace package — the durable scheduler that replaces the
in-process scheduler tick. The Inngest client + the `runScheduledAgent` function are
the SC-7-2 foundation; Plan 07-04 mounts the client on Hono `/api/inngest` and rewrites
pg_cron to fire `agent/scheduled.run` events at it.

## Key Files

### Created
- `packages/inngest/package.json` — workspace package (mirrors packages/vault shape); deps `@agent-os/core` (claimNextRun), `@agent-os/db`, `inngest@^4.5.0`.
- `packages/inngest/tsconfig.json` — extends base.
- `packages/inngest/src/client.ts` — `inngest` client with the dev-aware signingKey ternary `isDev ? undefined : process.env.INNGEST_SIGNING_KEY` (RESEARCH Pitfall 4 — never let a real signing key reach the unsigned dev relay).
- `packages/inngest/src/functions/runScheduled.ts` — `runScheduledAgent = inngest.createFunction({ id, concurrency:{limit:5} }, { event: "agent/scheduled.run" }, ...)`. Body claims the next due run via `claimNextRun` inside a checkpointed `step.run`. Inline comment distinguishes `concurrency.limit` (Inngest function-level) from the SDK `allowedTools` (Pitfall 5, Plan 06).
- `packages/inngest/src/index.ts` — re-exports client + function.
- `packages/inngest/src/inngest.test.ts` — asserts client construction + function metadata without a live relay/DB.

### Modified
- `pnpm-workspace.yaml` — fixed a duplicate `onlyBuiltDependencies` key + stray markdown fence left mid-build; `inngest` added to onlyBuiltDependencies.
- `pnpm-lock.yaml` — `inngest` install.

## Verification

- `pnpm --filter @agent-os/inngest exec tsc --noEmit` — clean.
- `pnpm --filter @agent-os/inngest test` — 5/5 pass (no live relay).
- `pnpm -r typecheck` — 11 packages pass (the new package joins the set).
- `pnpm --filter @agent-os/core run test:architect` — 31/31 (regression green).

## Pitfalls honored

- **Pitfall 4** (dev/signing-key trap): signingKey ternary makes dev mode never attempt signature verification against the unsigned relay.
- **Pitfall 5** (allowedTools): explicitly NOT conflated — `concurrency.limit` is Inngest's own knob; the SDK `allowedTools` narrowing lives in Plan 07-06. Inline comment documents the distinction.

## Notes

The original 07-03 executor stream-timed-out mid-build, leaving 4 files written
(client.ts correct) but the function file + test missing and `pnpm-workspace.yaml`
corrupted (duplicate key + stray fence). The orchestrator finished the plan inline:
wrote `functions/runScheduled.ts` + `inngest.test.ts`, repaired the workspace file,
added the missing `@agent-os/core` dep, and verified. Switched to inline execution for
the remaining Phase 7 plans — the background executors were stream-timing-out and
rewriting history on the shared branch, which is unsafe.

## Operator follow-ups

- A live Inngest relay (hosted or `inngest-cli dev`) + `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` are needed to exercise the function end-to-end. The unit test covers construction only.
