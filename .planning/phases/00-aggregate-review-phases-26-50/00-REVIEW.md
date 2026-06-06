---
phase: 00-aggregate-review-phases-26-50
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 45
findings:
  critical: 7
  warning: 13
  info: 5
  total: 25
status: issues_found
recommendation: hold — multiple cross-tenant isolation gaps and a systemic model-feedback attribution bug must be fixed before public-launch HARD GATE clears.
---

# Aggregate Review: Phases 26-50

Reviewer: Claude (gsd-code-reviewer) · Depth: standard · Reviewed: 2026-06-06

(See full review body returned by the agent — preserved below for record.)

## Critical Issues (7)

- **CR-01** `/api/admin/models/proposals` lists ALL tenants' proposals (`apps/api/src/index.ts:824-834`) — proposals table has no tenant_id; any admin reads everyone's pending tuning data.
- **CR-02** `/api/admin/models/proposals/:id/decide` lets any admin apply ANY tenant's proposal (`apps/api/src/index.ts:837-878`) — same root cause; client tenant can corrupt platform-wide capability_scores.
- **CR-03** `GET /api/admin/scorecards/xtenant-agg` exposes other tenants' performance metrics (`apps/api/src/index.ts:498-527`) — gated only by `requireAdmin`; per-client competitive leak.
- **CR-04** Model feedback loop attributes outcomes to baseline model, not the forked model (`packages/inngest/src/functions/applyModelFeedback.ts:74-86, 151-156`) — every per-task fork outcome credits/blames the wrong slug.
- **CR-05** Per-tool `model.routed` emit creates a false audit trail (`apps/runner/src/custom-tools.ts:308-359`) — event payload claims a fork that never ran on the SDK.
- **CR-06** `autoApply` transaction has lost-update race against operator decide (`applyModelFeedback.ts:195-221` + `apps/api/src/index.ts:858-877`) — concurrent decisions clobber jsonb capability_scores.
- **CR-07** `tenants.default_model_override` validation missing (`apps/api/src/index.ts:945-954`) — admin can pin agents to Opus and burn budget.

## Warnings (13)

- **WR-01** `compareForecasts` returns recommendation that exceeds budget cap (`cost-forecast.ts:93-98`).
- **WR-02** `inferPrimaryCapability` substring matcher mis-classifies multi-keyword agents (`applyModelFeedback.ts:162-177`).
- **WR-03** Cantfail join in feedback loop has no tenant filter (`applyModelFeedback.ts:92-105`).
- **WR-04** BudgetTracker persister.insert is fire-and-forget — restart crash window (`tracker.ts:172-181`).
- **WR-05** `cap_breached` event state reflects pre-update reservedTotal (`tracker.ts:148-162`).
- **WR-06** Runner has 4 separately-cached `Db` connection pools.
- **WR-07** Artifact POST endpoint has no size cap on `inlinePayload`.
- **WR-08** `outputDir` in dispatchCustomTool never cleaned up.
- **WR-09** Artifact `uri` scheme `file://...` not reachable from API host.
- **WR-10** Migration 0019 seed updates skills without tenant scoping.
- **WR-11** `verdict` query param not validated to allowed enum.
- **WR-12** `tracker.toEvent` shallow metadata clone — brittle.
- **WR-13** `pickModelIntelligently` doesn't refuse fork TO T-critical (perimeter gap).

## Info (5)

- **IN-01** Multiple admin-write endpoints accept untyped bodies via `as { ... }` casts.
- **IN-02** `loadObservations` row limit is a magic number (5000).
- **IN-03** `pickTierFromCatalog` returns null and silently shadows tier audit.
- **IN-04** `inferPrimaryCapability` dead-code `code_generation` branch for cliently.dev (out of AgentOS scope).
- **IN-05** Seed data in 0020 — clarify `last_observed_at` not auto-refreshed.

## Key cross-cutting recommendation

Before production: resolve CR-01 / CR-02 / CR-03 (tenant isolation) and CR-04 / CR-05 (feedback attribution + audit honesty). Other Criticals can ship with operator runbooks; the multi-tenant invariants cannot.

T-critical doctrine alignment is intact across every new code path. CRA prohibition guard at `execute.ts:116-150` correct. Migrations correctly require `is_tenant_member()` and apply RLS to new tables.
