# Phase 22 — Per-run autonomy ratchet on injection detection

**Triggered by:** Phase 13 `prompt-injection-guardrail` skill workflow step 5 — "ratchet autonomy down on a match, never up"
**Status:** complete (executed inline)
**Type:** runtime safety / closes a Phase 13 doctrine claim

## Goal

Ship the mid-run autonomy downgrade the `prompt-injection-guardrail` skill specifies. When a prompt-injection is detected in tool-returned content, the rest of the run completes at `propose` regardless of the bundle's original autonomy — operator-in-the-loop for any subsequent action.

## Delivered

### `apps/runner/src/run-state.ts`

Singleton Map keyed by `runId`, storing per-run mutable state:
- `autonomyOverride: Autonomy | null` — once set, the PreToolUse gate uses this instead of `bundle.autonomy`
- `ratchetReasons: string[]` — append-only audit trail of every ratchet trigger

API:
- `ratchetAutonomy(runId, to, reason)` — only ratchets DOWN; upgrade attempts are no-ops with no audit entry
- `getAutonomyOverride(runId)` — read the override or null
- `getRatchetReasons(runId)` — read the trail
- `effectiveAutonomy(runId, fallback)` — convenience for the gate
- `clearRunState(runId)` — called from `executeRun` at run close to free state
- `resetAllRunStateForTests()` — test helper

### Hook integration (`apps/runner/src/hooks.ts`)

`buildPreToolUseHook` now consults `effectiveAutonomy(runId, ctx.autonomy)` before calling `autonomyGate`. If an override is set, every subsequent tool call is gated as if the agent were at the override level. Non-invasive — when no override is set, behavior is identical to before.

### Trigger point (`apps/runner/src/custom-tools.ts`)

`tool.browser` handler calls `ratchetAutonomy(runId, "propose", reason)` when any injection patterns are detected in the scraped result. The redaction marker has already touched the planner's context; the ratchet ensures the planner's next action is operator-gated.

### Cleanup (`apps/runner/src/execute.ts`)

`executeRun` calls `clearRunState(bundle.run.id)` after the BudgetTracker close — guarantees no Map leakage across runs in the singleton process.

### Tests (`apps/runner/src/run-state.test.ts`)

19 assertions across 6 groups:
- No override returns fallback
- Ratchet down sets override + records reason
- Ratchet only goes down (upgrades are no-ops)
- Multiple legitimate downgrades accumulate reasons
- `clearRunState` frees state
- Independent runs do not affect each other

## Scope

WRITE: `apps/runner/src/run-state.ts(.test.ts)`, `apps/runner/src/hooks.ts`, `apps/runner/src/custom-tools.ts`, `apps/runner/src/execute.ts`, `apps/runner/package.json`

NOT touched: `packages/core` (pure modules unchanged), T-critical seeds, skill files, CLAUDE.md

## Acceptance ✓

- `pnpm --filter @agent-os/runner test:run-state` → 19 passed, 0 failed
- `pnpm --filter @agent-os/runner test:budget` → 11 passed (regression)
- `pnpm --filter @agent-os/runner test:cantfail` → 7 passed
- `pnpm --filter @agent-os/runner test` → 6 passed
- `pnpm --filter @agent-os/runner typecheck` clean
- Phase 12-21 `@agent-os/core` regressions all still green

## Doctrine claim now load-bearing

Phase 13 SKILL (`prompt-injection-guardrail`) workflow step 5: "Autonomy ratchets down on a match, never up. A run that detected an injection completes in propose mode regardless of the agent's normal tier."

That sentence was aspirational at Phase 13. With Phase 15 it became observable (detections are recorded). With Phase 19 it became audited (findings emitted). With Phase 22 it is **enforced** — the runner's tool gate consults the override on every subsequent tool call.

## Out of scope (next)

- Connector tool integration (`tool.connector.*`) — same ratchet trigger pattern when those land
- DB-backed per-run state for runner restart resilience
- Operator surfacing — a dashboard view of recent ratchet events (read from finding.recorded + emit a new `autonomy.ratcheted` event if needed)
