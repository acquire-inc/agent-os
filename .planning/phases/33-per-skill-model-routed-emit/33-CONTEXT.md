# Phase 33 — Per-skill model.routed emission at run start

**Triggered by:** Phase 32 wired per-tool model.routed at dispatch time; this phase covers the per-skill axis.
**Status:** complete

## Delivered

`apps/runner/src/execute.ts` — after `openRun + hydrateRun`, scans `bundle.skills[]` for any skill whose `preferredModelTier` would fork the baseline tier. For each fork-eligible skill, emits a `model.routed` Relay event with `{ agent_model, forked_to, forked_tier, task_label: "skill:<key>", reason }`.

- T-critical agents skipped (safety floor)
- Same-tier skill preferences skipped (no fork)
- Best-effort emit; errors logged, never thrown into the run

The audit trail now captures every potential fork the agent could take, before the run actually invokes the skill. Combined with Phase 32's tool-side emission, an operator can query relay_events for `model.routed` per run and see the full fork space.

## Acceptance ✓

- Typecheck clean
- All existing runner suites still green
