# Phase 18 — Agent evaluator scorecard (pure module)

**Triggered by:** Doctrine claim "promotion is earned from eval/approval-rate metrics; demotion is automatic on drops" — needs concrete math.
**Status:** complete (executed inline)
**Type:** runtime / autonomy ladder

## Goal

Ship the math that makes the AgentOS autonomy ladder (`propose` → `execute_safe` → `execute_full`) load-bearing instead of aspirational. This is the pure scoring layer; the scheduled job that walks each agent and applies the verdict is a follow-up phase.

## Delivered

- `packages/core/src/eval/scorecard.ts` — pure `scoreAgent(runs, thresholds)` function
- `packages/core/src/eval/scorecard.test.ts` — 33 assertions across 13 groups
- Exports: `scoreAgent`, `DEFAULT_THRESHOLDS`, `Scorecard`, `RunSample`, `ScorecardThresholds`, `Verdict`
- `packages/core/package.json` script: `test:scorecard`

## Verdict ladder

1. **`force_demote_safety`** — any `cantfail.*` event in the window → automatic demotion to propose, no override. Unconditional safety floor.
2. **`insufficient_data`** — sample window < `minSampleSize` (default 20). Lifecycle controller leaves autonomy unchanged.
3. **`demote`** — any of 5 thresholds tripped:
   - `verificationRate < 0.85`
   - `avgCostUtilization > 0.85`
   - `findingsRatePerRun > 0.1` (severity≥medium)
   - `scopeLockRefusalsPerRun > 0.5`
   - `outputQualityFailureRate > 0.1`
4. **`hold`** — between demote floor and promote bar.
5. **`promote`** — all promote bars cleared:
   - `approvalRate >= 0.9`
   - `verificationRate >= 0.95` (tighter than the demote floor)
   - `avgCostUtilization < 0.765` (0.9× the demote ceiling)

## Inputs

`RunSample` interface — the lifecycle job reads `run_summaries.highlights` jsonb + Relay event aggregates and constructs one of these per run in the window:
- `status` — terminal status
- `verificationPassed` — from `highlights.verification.passed`
- `approvalApproved` / `approvalRejected` — from `approval.resolved` Relay events
- `costUsd`, `budgetCapUsd` — direct
- `findingsHighMed` — `finding.recorded` count with severity ≥ medium
- `cantfailEventCount` — `cantfail.*` count (safety floor)
- `scopeLockRefusals` — from `highlights.scope_lock.refused_expansion_attempts.length`
- `outputQualityFailed` — from `highlights.output_quality.passed === false`

## Scope

WRITE: `packages/core/src/eval/`, `packages/core/src/index.ts`, `packages/core/package.json`

NOT touched: T-critical seeds, skill files, CLAUDE.md, hydrate.ts, runner

## Acceptance ✓

- `pnpm --filter @agent-os/core test:scorecard` → 33 passed, 0 failed
- 13 test groups cover: insufficient data, safety floor, promote/hold/demote on every threshold, custom thresholds, empty input, rationale completeness
- All Phase 12-17 regressions still green
- Typecheck clean

## Out of scope (follow-up phases)

- **Scheduled job**: walk each agent, fetch its last N run_summaries + Relay events, compute scorecard, write to a new `agent_scorecards` table, call `lifecycle.setAutonomy()` on demote/promote/force_demote. Needs:
  - `agent_scorecards` migration
  - Query layer to fetch the window
  - Lifecycle integration (already partially exists — `setRunStatus`, `raiseApproval` are there; `setAutonomy` needs the promotion/demotion endpoints)
- **Cross-tenant scorecard aggregation**: feeds the moat lens — what agent classes are promoting fastest across tenants. Reads `agent_scorecards` filtered through `consentScope='cross_tenant_aggregated'`.
- **Per-tenant threshold overrides**: doctrine allows agent-onboarder a tighter cycle (already supported via `scoreAgent(runs, customThresholds)` arg).
