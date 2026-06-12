# IDEAS.md — Platform Idea Ledger

> OS-RALPH idea scan output. Max 2 new PENDING per run. Test applied to every
> entry: "would tenant #2 want this on day one?" If only Acqu wants it, it
> belongs in the Acqu layer, not here.

## PENDING

### I-001 · Tenant config JSONB shape validation (write-time)
`tenants.tier_overrides`, `tenants.scorecard_thresholds`, and `tenants.feature_flags`
are free-form JSONB. A malformed override (typo'd tier name, string where number
expected) silently no-ops or — worse — falls through to defaults without telling
the operator. Add a Zod schema per knob, validated at the API write path (PUT
tier-overrides already does this partially; scorecard_thresholds and
feature_flags do not), plus a `validateTenantConfig()` sweep usable as a
migration-time check.
*Day-one test:* yes — every tenant that touches a policy knob wants malformed
config refused loudly. · *Class B (review gate).* · Added 2026-06-12.

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
- I-002 (shipped — see PENDING entry; left there as the audit row)

## REJECTED / MOVED-TO-ACQU-LAYER
(none yet)
