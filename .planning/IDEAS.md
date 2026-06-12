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

### I-002 · Offline dispatch/results contract test (CI-runnable)
The only true dispatch/results contract test (`packages/core/src/integration.test.ts`)
requires a live DATABASE_URL, so CI and sandbox runs skip the platform's most
load-bearing seam. Extract the contract shape (run row → dispatch → result
write-back → summary compose) into a sink-based offline test, mirroring how
eval/job.ts, objective.ts, and critic.ts test their DB seams. The live test
stays as the operator gate; the offline twin catches drift on every push.
*Day-one test:* yes — contract drift breaks every tenant simultaneously.
*Class B (review gate).* · Added 2026-06-12.

## APPROVED
(none yet)

## REJECTED / MOVED-TO-ACQU-LAYER
(none yet)
