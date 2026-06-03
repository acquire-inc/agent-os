# Phase 20 — Scorecard controller + agent_scorecards migration

**Triggered by:** Phase 18 ships the math; the persistence layer + autonomy controller is the next leg.
**Status:** complete code-side (executed inline). Migration is queued for operator push.
**Type:** runtime / autonomy ladder closure

## Goal

Close the loop on eval-driven autonomy: persist scorecard verdicts and translate them to concrete autonomy moves.

## Delivered

### Migration

- `supabase/migrations/0014_agent_scorecards.sql` — `agent_scorecards` table + RLS + index on unapplied verdicts + a cross-tenant aggregate view (`agent_scorecards_xtenant_agg`)
- `packages/db/src/schema.ts` — matching Drizzle `agentScorecards` table

### Controller module

- `packages/core/src/eval/controller.ts` — pure `computeNextAutonomy(currentAutonomy, verdict, isCantFail)` → `ControllerDecision`
- 5 verdict cases:
  - `force_demote_safety` → propose, unconditional (even cant-fail agents that drifted up)
  - `demote` → one step down the ladder
  - `promote` → one step up the ladder, capped at `execute_safe` for cant-fail agents (no `execute_full` for them — doctrine)
  - `hold` / `insufficient_data` → unchanged
- Unknown current autonomy biases to `propose` floor

### Tests

- `packages/core/src/eval/controller.test.ts` — 25 assertions across 7 groups
- Exports added to `packages/core/src/index.ts` + `package.json` script

## Scope

WRITE: `supabase/migrations/0014_agent_scorecards.sql`, `packages/db/src/schema.ts`, `packages/core/src/eval/controller.ts(.test.ts)`, `packages/core/src/index.ts`, `packages/core/package.json`

NOT touched: T-critical seeds, skill files, CLAUDE.md, hydrate.ts, runner

## Acceptance ✓

- `pnpm --filter @agent-os/core test:controller` → 25 passed, 0 failed
- `pnpm --filter @agent-os/db typecheck` clean (new agentScorecards table)
- `pnpm --filter @agent-os/core typecheck` clean
- All 9 prior test suites still green

## Operator gate (when DB access available)

```bash
supabase db push
```

This pushes migration 0014. After push, the scheduled scorecard job can persist verdicts.

## Out of scope (next phases)

- **Scheduled job runner**: the Inngest function (or cron entry) that walks each agent, fetches its window of run_summaries + relay events, calls `scoreAgent()`, persists to `agent_scorecards`, then calls `computeNextAutonomy()` and (on `changed=true`) executes the autonomy `UPDATE`. Needs Inngest integration + a per-tenant agent enumeration query.
- **Lifecycle setAutonomy endpoint**: the actual UPDATE on `agents.autonomy` + the `lifecycle.changed` Relay event. The lifecycle module has the infrastructure; the new endpoint is the wiring.
- **Per-tenant threshold overrides**: agent-onboarder doctrine specifies a tighter cycle; `scoreAgent()` already accepts custom thresholds. The job needs to look up per-tenant config.
