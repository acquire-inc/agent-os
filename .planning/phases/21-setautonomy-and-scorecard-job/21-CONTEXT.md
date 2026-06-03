# Phase 21 — `setAutonomy` lifecycle + scorecard job orchestrator

**Triggered by:** Phase 20 ships the persistence + controller; Phase 21 ships the actual mutation path and the job that drives it.
**Status:** complete (executed inline)
**Type:** runtime / autonomy ladder loop closure

## Goal

Ship the autonomy mutation function and the orchestration that strings together: fetch run window → score → persist → decide → apply. The scheduled trigger (Inngest function or cron) is a thin wrapper around this.

## Delivered

### `setAutonomy` in `packages/core/src/lifecycle.ts`

```ts
setAutonomy(db, { tenantId, agentId, nextAutonomy, reason })
```

- Atomic UPDATE on `agents.autonomy` + `lifecycle.changed` Relay event emission in the same db.transaction
- Cross-tenant gate: returns null if `agentId` does not belong to `tenantId`
- No-op on `nextAutonomy === current` (defensive — controller already guards)
- Event payload includes `previous`, `next`, `reason`, `kind: "autonomy"` (distinguishes from lifecycleState transitions)

### `runScorecardJob` in `packages/core/src/eval/job.ts`

```ts
runScorecardJob(inputs, sink) → ScorecardJobResult
```

Pure orchestrator. Takes a `ScorecardJobSink` interface (4 callbacks) so unit tests don't need a live db. Production wiring (separate phase) builds the sink with Drizzle queries:

- `fetchRunSamples(inputs)` → query `run_summaries` + relay event aggregates for the window
- `persistScorecard(row)` → INSERT into `agent_scorecards`
- `applyAutonomy(args)` → call `setAutonomy`
- `markApplied(args)` → UPDATE `agent_scorecards.applied_at` + `applied_autonomy`

Job behavior:
- Empty / small window → verdict `insufficient_data`, no autonomy mutation, scorecard still persisted (audit trail)
- `force_demote_safety` → mutation regardless of operator overrides
- `applyAutonomy` returning null (agent not found) → `appliedAutonomy = "unchanged"`, still markApplied
- `NaN` rates (no approval cycle in window) → persisted as `null`

### Tests

- `packages/core/src/eval/job.test.ts` — 25 assertions across 6 groups
- Exports added to `packages/core/src/index.ts` + `package.json` scripts

## Scope

WRITE: `packages/core/src/lifecycle.ts` (append `setAutonomy`), `packages/core/src/eval/job.ts(.test.ts)`, `packages/core/src/index.ts`, `packages/core/package.json`

NOT touched: runner, T-critical seeds, skill files, CLAUDE.md, hydrate.ts, schema

## Acceptance ✓

- `pnpm --filter @agent-os/core test:job` → 25 passed, 0 failed
- `pnpm --filter @agent-os/core test:controller` → 25 passed, 0 failed (regression)
- Full `@agent-os/core` suite (10 tests, 338 assertions) all green
- Typecheck clean

## Out of scope (next phases)

- **Inngest scheduled trigger**: a function wrapping `runScorecardJob` for each active agent on a cron. Needs Inngest dev access + per-tenant agent enumeration query.
- **`agent_scorecards` UPDATE column add** for `applied_autonomy` semantics — the migration covers it already; the job calls `markApplied` to update it.
- **Operator dashboard view**: list recent scorecards + applied autonomy moves. Reads from `agent_scorecards` + `agent_scorecards_xtenant_agg` view.
