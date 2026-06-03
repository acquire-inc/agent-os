# Phase 23 — Cap-breach Approval surfacing

**Triggered by:** Phase 13 `cost-ceiling-discipline` SKILL workflow step 5 — "Raise an Approval asking the operator to either raise the cap, accept partial, or abort."
**Status:** complete

## Goal

When `BudgetTracker.reserveSpend` refuses a reserve because it would breach `agents.budgetCapUsd`, surface the breach as an operator Approval with three options: `raise` / `truncated` / `abort`.

## Delivered

- `packages/core/src/autonomy.ts` — `buildCapBreachApprovalOptions()` returns the three operator levers
- `packages/core/src/lifecycle.ts` — `raiseCapBreachApproval(db, args)` wraps `raiseApproval` with the right context + options
- `apps/runner/src/execute.ts` — when the synthesize-end-of-run reserve breaches, emits `budget.cap_breached` (Phase 19) AND raises the Approval (Phase 23). Best-effort; emission path is the guaranteed audit trail

## Acceptance ✓

- `pnpm --filter @agent-os/core typecheck` clean
- `pnpm --filter @agent-os/runner typecheck` clean
- All runner tests green (no regression)
