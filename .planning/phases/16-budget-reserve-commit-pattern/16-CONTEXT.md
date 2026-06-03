# Phase 16 — Budget reserve/commit/release pattern

**Triggered by:** Phase 13's `cost-ceiling-discipline` skill assumes `reserveSpend` / `commitSpend` / `releaseSpend` runtime tools
**Status:** complete (executed inline)
**Type:** runtime safety / budget enforcement

## Goal

Ship the reserve/commit/release pattern the Phase 13 `cost-ceiling-discipline` skill assumes. Without it, the skill runs in observational-only mode (its documented pre-binding state).

## Delivered

- `packages/core/src/budget/tracker.ts` — `BudgetTracker` class
  - Per-run state keyed by `runId` (in-memory Map; db-backed impl is a follow-up phase + migration)
  - `openRun(runId, capUsd)` — start tracking
  - `reserveSpend(runId, amount, metadata?)` — refuses if `committed + reserved + amount > cap`; emits `budget.cap_breached` (once per run) on refusal; emits `budget.reserved` on success
  - `commitSpend(runId, reservationId, actualUsd)` — moves the reservation to committed total; emits `budget.committed`
  - `releaseSpend(runId, reservationId)` — drops the reservation; emits `budget.released`
  - `closeRun(runId)` — emits `budget.summary` with cap utilization and clears the run state
  - All emissions go through a caller-supplied `BudgetEventSink` (so the runner wires it to Relay event emission; tests use a sunk array)
- 5 new Relay event names registered in `packages/core/src/relay/events.ts`:
  - `budget.reserved`, `budget.committed`, `budget.released`, `budget.cap_breached`, `budget.summary`
- `packages/core/src/budget/tracker.test.ts` — 49 assertions across 7 groups
- Exports added to `packages/core/src/index.ts` and `package.json` test script

## Scope

WRITE: `packages/core/src/budget/`, `packages/core/src/relay/events.ts`, `packages/core/src/index.ts`, `packages/core/package.json`

NOT touched: T-critical seeds, skill files, CLAUDE.md, hydrate.ts, tier-models.ts, runner

## Acceptance ✓

- `pnpm --filter @agent-os/core test:budget` → 49 passed, 0 failed
- All 5 new Relay event names accepted by `relay.test.ts` (29 passed, 0 failed — closed namespace check passes)
- Phase 12, 14, 15 regressions all still green
- Typecheck clean

## Out of scope (next phases)

- **Runner integration**: Phase 17 candidate — wire `BudgetTracker` into the runner's tool dispatch path so every LLM call and paid tool call goes through `reserveSpend` → `commitSpend|releaseSpend`. The cap-breach path raises an Approval per the skill's workflow step 5.
- **Db-backed persistence**: Phase 18 candidate — `budget_reservations` table + migration so reserves survive runner restart mid-run.
- **Cross-run aggregate dashboard**: separate phase, reads from `budget.summary` Relay event stream.
