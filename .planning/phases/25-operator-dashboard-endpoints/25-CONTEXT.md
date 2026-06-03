# Phase 25 — Operator dashboard endpoints over agent_scorecards

**Triggered by:** Phase 20-21 ship persistence + job; this phase makes verdicts visible to the operator.
**Status:** complete

## Goal

Read endpoints over `agent_scorecards` so the operator dashboard (and the future cross-AI scorecard review) can answer: "which agents are demoting?" and "what's the latest verdict for X?"

## Delivered

Two admin-gated GETs in `apps/api/src/index.ts`:

- `GET /api/admin/scorecards?agent_id=<uuid>&limit=<n>` — recent scorecards for this tenant (optionally filtered to one agent), ordered by `created_at DESC`, default limit 50, capped at 200
- `GET /api/admin/scorecards/latest` — most recent scorecard per agent for this tenant (Postgres `DISTINCT ON` via `db.execute(sql\`...\`)`)

Both endpoints respect tenant isolation through the `requireAdmin` middleware + explicit `tenant_id` filter.

## Acceptance ✓

- `pnpm --filter @agent-os/api typecheck` clean
- Endpoints return `{ scorecards: [...] }` shape consistent with existing admin reads
