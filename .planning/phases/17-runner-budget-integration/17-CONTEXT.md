# Phase 17 — Runner BudgetTracker integration

**Triggered by:** Phase 16 ships the tracker; this phase wires it into the runner
**Status:** complete (executed inline)
**Type:** runtime / budget enforcement

## Goal

Wire the Phase 16 `BudgetTracker` into the runner's `executeRun` lifecycle so the `budget.*` event stream is populated for every run (success, cantfail violation, CRA violation, exception).

## Delivered

- `apps/runner/src/budget.ts` — singleton tracker + default console sink
  - `getBudgetTracker()` — lazy-init singleton
  - `resetBudgetTrackerForTests()` — test-only reset
  - Default sink emits a compact `[budget]` log line for each event
- `apps/runner/src/execute.ts` — lifecycle integration in `executeRun`:
  - `tracker.openRun(runId, capUsd)` at entry
  - On success with `costUsd > 0` and cap > 0: synthesize `reserveSpend` + `commitSpend` for the run's terminal spend
  - `tracker.closeRun(runId, { final_status })` on every exit path (success, cantfail violation, CRA violation, thrown exception)
- `apps/runner/src/budget.test.ts` — 4 groups, 11 assertions:
  - Successful dry-run lifecycle closes the run after executeRun
  - cantfail.model_violation still triggers closeRun
  - cantfail.cra_violation still triggers closeRun
  - cap=0 bundle skips synthesize but still closes
- `apps/runner/package.json` script: `test:budget`

## Scope

WRITE: `apps/runner/src/budget.ts(.test.ts)`, `apps/runner/src/execute.ts`, `apps/runner/package.json`

NOT touched: T-critical seeds, skill files, CLAUDE.md, hydrate.ts, custom-tools.ts (per-tool reserve/commit is a follow-up)

## Acceptance ✓

- `pnpm --filter @agent-os/runner test:budget` → 11 passed, 0 failed
- `pnpm --filter @agent-os/runner test:cantfail` → 7 passed, 0 failed (no regression)
- `pnpm --filter @agent-os/runner typecheck` clean
- Phase 12-16 regressions all green

## Out of scope (follow-up phases)

- **Per-tool reserve/commit**: `tool.browser` (and other paid custom tools) get a reserve-before / commit-after wrapper using per-tool cost estimates. Needs a per-tool cost-estimate column on the tools registry.
- **Relay emission**: BudgetEvent → Relay event emission. Default sink logs to console today; the production sink wires through the runner's relay-db handle (already exists for cantfail emissions). The 5 new event names are registered (Phase 16); the emission path is the wiring.
- **Cap-breach Approval surfacing**: per the skill's workflow step 5, a cap breach should raise an Approval with revise / accept-truncated / abort options. Today the breach returns to the caller; the caller decides. Wiring through the runner's approval surface is the next step.
- **Db-backed persistence**: `budget_reservations` table + migration so reserves survive runner restart mid-run.
