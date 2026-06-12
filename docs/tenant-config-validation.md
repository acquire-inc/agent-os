# Tenant Config Validation

**Audience:** API authors, settings-UI authors, and agents extending the tenant
policy surface. Pair: this doc + `packages/core/src/tenant-config.ts` +
`tenant-config.test.ts` (38 assertions, offline).

## What this validates

Two JSONB knobs on `tenants`:

- `tier_overrides` — per-tier model slug overrides
- `scorecard_thresholds` — per-tenant evaluator threshold tuning

Both accept free-form JSON in the schema. Without write-time validation, a
malformed override silently no-ops or falls through to defaults — the
operator never finds out the knob didn't take. The validators fail loud
so the write path can refuse garbage and the UI can surface a usable error.

## Usage

```ts
import { validateTenantConfig } from "@agent-os/core";

const result = validateTenantConfig({
  tierOverrides: req.body.tier_overrides,
  scorecardThresholds: req.body.scorecard_thresholds,
});

if (!result.ok) {
  return res.status(400).json({ errors: result.reasons });
}
// result.tierOverrides / result.scorecardThresholds are narrowed,
// safe to write.
```

Individual validators are also exported when only one knob is being patched:
`validateTierOverrides(raw)` and `validateScorecardThresholds(raw)`. Each
returns `{ ok, value?, reasons[] }`.

## Doctrine encoded as rejection rules

| Rejection | Why |
|---|---|
| `tier_overrides["T-critical"]` set at all | Tier wins, override loses (router doctrine). Runtime ignores it; we reject here so the operator sees the doctrine instead of a silent no-op. |
| Unknown tier name | Catches typos like `T-cheep`. |
| Model slug not `provider/model` shape | Catches naked slugs like `claude` or `gpt-4`. |
| Empty string slug | Use omit / null to clear, not `""`. |
| Threshold rate outside `[0, 1]` | Rates are proportions; out-of-band would silently swing the autonomy ladder. |
| Threshold count below 1 or non-integer | `minSampleSize` is a count of runs. |
| `minVerificationRateForPromote < minVerificationRate` | Pairing: promote threshold must be at least as strict as the demote floor. Otherwise the ladder can promote on numbers it wouldn't even hold on. |
| `maxCostUtilizationForPromote > maxCostUtilization` | Same pairing rule in the cost direction. |

## When to call the validator

- **Settings UI** — pre-flight before PUT, so the user sees errors inline.
- **Future bulk-config endpoint** — when adding `PUT /api/admin/tenants/me/config`
  that accepts both knobs at once, route the body through `validateTenantConfig`.
- **Migration safety check** — pass each tenant's current row through
  `validateTenantConfig` before a release that consumes the values.

The existing `PUT /api/admin/tenants/me/tier-overrides` does its own
catalog-membership check on top of the slug-shape check this validator
performs — both are correct, both should run.

## Extending

1. New tier: add to `MODEL_TIERS` in `packages/core/src/router/tier-models.ts`.
   `OVERRIDABLE_TIERS` is derived; T-critical stays excluded.
2. New threshold key: add the `FieldSpec` row in `SCORECARD_FIELDS` (kind,
   min, max, integer) and extend the `ScorecardThresholdOverrides` interface.
3. New pairing rule: add the pairwise check at the bottom of
   `validateScorecardThresholds`. Test it.

## Run the test

```bash
pnpm --filter @agent-os/core test:tenant-config  # 38/38 offline
```
