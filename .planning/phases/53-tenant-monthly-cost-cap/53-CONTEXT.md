# Phase 53 — Tenant-level monthly cost cap + aggregator

**Status:** planned
**Triggered by:** Phase 16-31 ship per-run cost tracking. Tenants need a monthly budget gate too — `tenants.monthly_budget_usd` exists but nothing enforces it.

## Goal

When a tenant's month-to-date spend (sum of all `budget.committed` events for the period) approaches or exceeds `tenants.monthly_budget_usd`, refuse new runs and emit `budget.tenant_cap_breached`. The chat dispatch endpoint surfaces this to the user before they dispatch.

## Architecture

```
Per-run BudgetTracker (Phase 16-17) — unchanged
  ↓ emits budget.committed events
  ↓
Materialized view: tenant_monthly_spend
  WITH tenant_id, month, total_usd, run_count
  Refreshed nightly (or on-demand)
  ↓
Chat dispatch:
  Before creating runs row → check tenant_monthly_spend vs cap
  If month-to-date + forecast > cap → 422 with rationale
  ↓
Runner:
  Before openRun → assert tenant cap not breached
  On breach during run → emit budget.tenant_cap_breached + Approval
```

## Deliverables

1. **Migration 0024** — materialized view `tenant_monthly_spend`:
   ```sql
   CREATE MATERIALIZED VIEW tenant_monthly_spend AS
   SELECT
     tenant_id,
     date_trunc('month', detected_at) AS month,
     SUM((payload->>'amount_usd')::numeric) AS total_usd,
     COUNT(DISTINCT run_id) AS run_count
   FROM relay_events
   WHERE event_name = 'budget.committed'
   GROUP BY tenant_id, month;
   ```
   + a nightly REFRESH MATERIALIZED VIEW Inngest function.

2. **Pure function** in `packages/core/src/budget/tenant-cap.ts`:
   - `checkTenantBudget(tenantBudgetUsd, monthToDateUsd, forecastUsd)`
     → `{ ok, remainingUsd, percentUsed }`

3. **API endpoint** — `GET /api/admin/tenants/me/budget-status`:
   - Returns `{ cap_usd, month_to_date_usd, remaining_usd, percent_used, projection_eom_usd }`

4. **Chat dispatch upgrade** — when tokens supplied, add tenant-budget
   gate. If month-to-date + forecast > cap, return 422 with budget
   rationale instead of inserting the run.

5. **Runner gate** — `assertTenantBudget(bundle)` called from
   `executeRun` SessionStart alongside `assertCantFailModel` and
   `assertNotCraProhibited`. Emits `budget.tenant_cap_breached` and
   fails the run closed.

6. **New Relay event** — `budget.tenant_cap_breached` added to the
   closed namespace.

## Out of scope

- Per-tenant per-agent caps (agents.budgetCapUsd is per-run already)
- Auto-pause agents when nearing cap (operator decision; future Phase)
- Cost forecasting beyond per-run (no projection_eom math beyond linear)

## Acceptance

- Tenant with $100 monthly cap, $95 month-to-date, $5 forecasted run →
  dispatch refused with 422
- `GET /api/admin/tenants/me/budget-status` returns accurate fields
- Runner refuses new dispatch on breach with `budget.tenant_cap_breached`
- Existing per-run cap behavior unchanged
