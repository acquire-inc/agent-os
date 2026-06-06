# Phase 34 — execute-flow integration test

**Triggered by:** Earlier in the session I proposed integration tests as the next testing surface; this phase ships the first one.
**Status:** complete

## Delivered

`apps/runner/src/execute-flow.test.ts` — 16 assertions across 5 groups exercising the full `executeRun` contract:

1. **Happy path:** dryRun lifecycle completes, tracker closes, run-state clears
2. **cantfail violation:** T-critical agent on Hermes → `failed`, summary names `cantfail.model_violation`, no cost, **tracker still closes** (CR-08 fix)
3. **CRA violation:** persona with CRA-touching language → `failed`, summary names `cra_violation`, tracker still closes
4. **Autonomy ratchet:** pre-ratchet survives through `executeRun`; `clearRunState` wipes it at the end
5. **cap=0 path:** no-cap bundle still dispatches; tracker still closes (WR-11 fix)

`apps/runner/package.json` script: `test:execute-flow`

## Acceptance ✓

- `test:execute-flow` → 16 passed, 0 failed
- All 5 runner suites + 17 core suites still green
- Typecheck clean

## What this covers that unit tests don't

- The cross-phase contract between cantfail → BudgetTracker → run-state cleanup. Each is unit-tested in isolation; this test asserts they compose correctly.
- The `try/finally` in `executeRun` from CR-08 — verifies cleanup fires on every exit path.
- The WR-11 fix — `budget.summary` emit on cap=0 paths.
- The Phase 22 ratchet's lifecycle — survives the run, clears after.

## Next testing surfaces (queued)

- `test:scorecard-flow` — end-to-end scorecard job against a stubbed sink with realistic per-run highlights
- `test:cap-breach-flow` — `dispatchCustomTool → CapBreachError → raiseCapBreachApproval` chain with mocked db
- `test:hydrate-restart` — simulate runner restart; verify reservations re-hydrate and sequence counter advances
