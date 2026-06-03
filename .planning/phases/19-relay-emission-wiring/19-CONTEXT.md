# Phase 19 — Relay emission wiring for BudgetEvent + injection detections

**Triggered by:** Phase 16 + 17 (budget) and Phase 15 (injection guard) — both deferred Relay emission.
**Status:** complete (executed inline)
**Type:** observability / audit trail

## Goal

Pipe BudgetTracker events and prompt-injection detections into the Relay event stream so the operator's audit + dashboard sees them, not just the runner's stdout.

## Delivered

### Budget event emission (`apps/runner/src/execute.ts`)

`executeRun` now emits Relay events for the full BudgetTracker lifecycle when `DATABASE_URL` is set:
- `budget.reserved` after each `reserveSpend` succeeds
- `budget.committed` after each `commitSpend` succeeds (payload includes `delta`)
- `budget.cap_breached` when a reserve is refused
- `budget.summary` at `closeRun` with cap utilization

Best-effort: emission failures log to stderr but never throw into the run.

### Injection finding emission (`apps/runner/src/custom-tools.ts`)

`tool.browser` handler emits one `finding.recorded` event per distinct injection category detected. Severity `high`, category `anomaly`, source `tool.browser`, payload includes the matched category, count, and the first-100-char preview of the matched span (no full payload — limits PII).

The handler context (`CustomToolHandlerCtx`) now carries `tenantId`, `runId`, `agentId` from the dispatching bundle. Backwards-compatible: ctx fields are optional, handlers without them still work for tests.

## Scope

WRITE: `apps/runner/src/execute.ts`, `apps/runner/src/custom-tools.ts`

NOT touched: `packages/core` (pure modules unchanged), T-critical seeds, skill files, CLAUDE.md, hydrate.ts

## Acceptance ✓

- `pnpm --filter @agent-os/runner test:budget` → 11 passed (regression check)
- `pnpm --filter @agent-os/runner test:cantfail` → 7 passed
- `pnpm --filter @agent-os/runner test` → 6 passed (custom-tools handler smoke)
- `pnpm --filter @agent-os/runner typecheck` clean
- All `@agent-os/core` regressions still green (Phases 12-18)

## Out of scope (follow-up)

- **Autonomy ratchet on injection match**: the Phase 13 skill says "on detection, run the rest of the turn in propose mode" — needs a runner-state field that the autonomy gate reads. Not in this phase.
- **Per-tool reserve/commit**: tool.browser etc. doing reserve-before-call with a per-tool cost estimate. Needs a per-tool cost estimate column.
- **Approval surfacing on cap-breach**: the Phase 13 skill says cap-breach raises an Approval with revise/accept-truncated/abort. Not wired here; the breach event is logged + emitted.
- **agent_scorecards table + scheduled job**: Phase 18 ships the math; the table + job that walks each agent is a separate phase.
