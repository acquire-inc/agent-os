# IDEAS.md — Platform Idea Ledger

> OS-RALPH idea scan output. Max 2 new PENDING per run. Test applied to every
> entry: "would tenant #2 want this on day one?" If only Acqu wants it, it
> belongs in the Acqu layer, not here.

## PENDING

### I-001 · Tenant config JSONB shape validation (write-time) — ✅ SHIPPED 2026-06-12
Note: `feature_flags` is NOT a column on `tenants` (verified at inventory);
the two real knobs are `tier_overrides` and `scorecard_thresholds`. Shipped:
`packages/core/src/tenant-config.ts` (hand-rolled validators — no zod dep)
+ `tenant-config.test.ts` (38/38) + `docs/tenant-config-validation.md`.
Doctrine encoded as rejection rules (T-critical override always rejected,
pairwise threshold consistency, slug shape `provider/model`). Wired into the
public core exports; ready for the Settings UI pre-flight and a future
bulk-config endpoint.

### I-002 · Offline dispatch/results contract test (CI-runnable) — ✅ SHIPPED 2026-06-12
Shipped on branch `os-ralph/2026-06-12-i-002-offline-dispatch-contract`:
`packages/core/src/dispatch-contract.ts` (status partitions w/ compile-time
exhaustiveness guard, state-machine transition validator, claim ordering,
Bundle shape validator, approval-cycle invariant, session-end invariant,
tools-registry contract) + `dispatch-contract.test.ts` (59/59) +
agent-readable `docs/dispatch-contract.md`. Standing gate added to PLATFORM.md.
The live integration test stays as the operator gate; this offline twin runs
on every push.

## APPROVED
- I-001 (shipped — see PENDING entry; left there as the audit row)
- I-002 (shipped — see PENDING entry; left there as the audit row)
- I-003 — Agent lease arbitration. SHIPPED 2026-06-12.
  Two-agent overlap on the same target (lead/deal/connector record/objective/
  tool invocation) was the operator-visible "slop / interfere" failure mode.
  packages/core/src/lease.ts + lease.test.ts (42/42) + mig 0029 (unique
  active-lease index) + docs/lease-arbitration.md. Doctrine encoded as hard
  rules: cant-fail preempts non-cant-fail, cant-fail-vs-cant-fail does NOT
  preempt, cant-fail TTL floor 5min, self-renew always grants. Two new relay
  events.

## REJECTED / MOVED-TO-ACQU-LAYER
(none yet)
