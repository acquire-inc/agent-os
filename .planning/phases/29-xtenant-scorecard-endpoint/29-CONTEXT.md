# Phase 29 — Cross-tenant scorecard aggregate endpoint (moat lens)

**Triggered by:** Phase 20 migration 0014 created the `agent_scorecards_xtenant_agg` view; this phase exposes it via an admin endpoint.
**Status:** complete

## Delivered

`apps/api/src/index.ts`:

- `GET /api/admin/scorecards/xtenant-agg?verdict=<v>&min_scorecard_count=<n>` — reads from the consent-filtered view. NOT scoped to the caller's tenant (deliberately — this is the moat lens that surfaces agent-class behavior across every tenant)
- Filters: optional verdict filter (`promote`/`demote`/etc.), minimum `scorecard_count` (default 1)
- Limit hard-capped at 200; ordered by `scorecard_count DESC`

## Operator use

"Which agent classes promote fast vs. demote often across the platform?" — feeds the agent-archetype catalog and the agent-onboarder's selection heuristic.

## Acceptance ✓

- Typecheck clean
