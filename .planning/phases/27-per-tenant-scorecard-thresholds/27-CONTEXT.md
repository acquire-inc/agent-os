# Phase 27 — Per-tenant scorecard threshold overrides

**Triggered by:** Doctrine — "agent-onboarder runs on a tighter cycle." Phase 18's `ScorecardThresholds` always accepted a custom argument; what was missing was the operator path to specify it per tenant.
**Status:** complete

## Delivered

- `supabase/migrations/0017_tenants_scorecard_thresholds.sql` — `tenants.scorecard_thresholds JSONB DEFAULT '{}'`
- `packages/db/src/schema.ts` — `tenants.scorecardThresholds` typed as `Partial<ScorecardThresholds>`
- `packages/inngest/src/functions/scoreAgentsScheduled.ts`:
  - `mergeThresholds(override)` — merges partial overrides on top of `DEFAULT_THRESHOLDS`, with NaN / negative / non-numeric values falling back
  - Sweep fetches `tenants.scorecardThresholds` once per tenant in the window and caches in a Map
  - Per-target loop passes the merged thresholds via `runScorecardJob`'s `thresholds` input

## Operator usage

```sql
-- agent-onboarder tight cycle
UPDATE tenants
SET scorecard_thresholds = '{"minSampleSize": 5, "minApprovalRateForPromote": 0.8}'::jsonb
WHERE slug = 'agent-onboarder';
```

## Acceptance ✓

- Typecheck clean across core / db / runner / api / inngest
- All test suites still green
