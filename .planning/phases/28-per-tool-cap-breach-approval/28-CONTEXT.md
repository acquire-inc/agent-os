# Phase 28 — Per-tool cap-breach Approval surfacing

**Triggered by:** Phase 13 `cost-ceiling-discipline` SKILL workflow step 5 — "Raise an Approval asking the operator to either raise the cap, accept partial, or abort." Phase 26 added the per-tool reserve refusal (CapBreachError); Phase 28 surfaces the Approval before the throw.

**Status:** complete

## Delivered

`apps/runner/src/custom-tools.ts` — `dispatchCustomTool` now calls `raiseCapBreachApproval` BEFORE throwing `CapBreachError`. Same lever set as the end-of-run path (raise / truncated / abort). Best-effort: if no db handle, throw the sentinel anyway so the caller can still react.

## Acceptance ✓

- Typecheck clean
- All test suites still green
