# Phase 26 — Per-tool reserve/commit + tool cost estimates

**Triggered by:** Phase 13 `cost-ceiling-discipline` SKILL workflow steps 2-4 (reserve before spend, commit after, release on failure) and Phase 23's deferred per-tool reserve.
**Status:** complete
**Type:** runtime / budget enforcement

## Goal

Add per-tool cost estimates to the `tools` registry and wrap every custom-tool dispatch with the BudgetTracker reserve-before / commit-after pattern from the cost-ceiling-discipline skill. A reserve that would breach the agent's `budgetCapUsd` refuses the dispatch (the tool call does NOT run).

## Delivered

### Migration

- `supabase/migrations/0016_tools_cost_estimate.sql` — adds `tools.cost_estimate_usd NUMERIC(12,4) NOT NULL DEFAULT 0` plus seed values for the 5 existing deterministic tools (`tool.browser` = $0.10; the security tools default to $0.00)

### Schema

- `packages/db/src/schema.ts` — `tools.costEstimateUsd` Drizzle column added
- `packages/core/src/bundle.ts` — `Bundle.tools[].costEstimateUsd: string` flows through `buildBundle()`
- `apps/runner/src/api-client.ts` — wire shape mirrors the new field (`costEstimateUsd?: string | number`)

### Runner integration

- `apps/runner/src/custom-tools.ts`:
  - New `CapBreachError` class — sentinel thrown when reserve breaches the cap
  - `dispatchCustomTool` now reserves before invoking the handler, commits on success, releases on failure
  - Reserve uses `bundle.tools[i].costEstimateUsd`; zero-cost tools still go through the lifecycle for audit consistency
  - Skips reserve/commit cleanly when the tracker has no open run (test fixture paths)

### Tests

- `apps/runner/src/custom-tools.test.ts` — Phase 26 group adds 8 assertions across 4 cases:
  1. Cap=$1.00, estimate=$0.30 → commit succeeds, handler runs
  2. Cap=$0.10, estimate=$0.30 → CapBreachError, handler does NOT run
  3. No tracker open → handler still runs (no-op reserve path)
  4. Handler throws → reservation released (no commit, no leak)

## Scope

WRITE: `supabase/migrations/0016_tools_cost_estimate.sql`, `packages/db/src/schema.ts`, `packages/core/src/bundle.ts`, `apps/runner/src/api-client.ts`, `apps/runner/src/custom-tools.ts(.test.ts)`

NOT touched: T-critical seeds, skill files, CLAUDE.md, hydrate.ts, executeRun's synthesize block (still ships end-of-run reserve)

## Acceptance ✓

- `pnpm --filter @agent-os/runner test` → 14 passed (was 6, +8 Phase 26 assertions)
- All 4 runner test suites + 12 core test suites still green
- Typecheck clean across core / db / runner / api / inngest

## Operator gate

- Migration 0016 must be pushed (`supabase db push`). After push, the seeded estimates take effect; agents on `tool.browser` will see $0.10 reservations per call

## Out of scope

- Per-tool cost-estimate UI in the operator dashboard
- Refining estimates from actual cost data (a feedback loop reading `budget.committed` events and adjusting `tools.cost_estimate_usd` per tool)
- Cap-breach handling at the per-tool layer (today CapBreachError surfaces to the SDK as a thrown error; future: the runner could catch and surface as an Approval via `raiseCapBreachApproval`, similar to the end-of-run path)
