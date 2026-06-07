-- Migration 0025: tenant-level monthly cost cap infrastructure.
--
-- Phase 53. tenants.monthly_budget_usd exists (migration 0001) but nothing
-- enforces it. This migration adds:
--   1. A materialized view tenant_monthly_spend aggregating budget.committed
--      events per (tenant, month). Refreshed by the Inngest function
--      applyMonthlyCostRollup nightly.
--   2. A helper function tenant_month_to_date_usd(tenant_id) for ad-hoc
--      queries that don't want to read the view (or need fresher data).
--   3. budget.tenant_cap_breached event name reserved in the closed
--      Relay namespace (added separately in events.ts).

CREATE MATERIALIZED VIEW IF NOT EXISTS tenant_monthly_spend AS
SELECT
  tenant_id,
  date_trunc('month', occurred_at) AS month,
  SUM(COALESCE((payload->>'amount_usd')::numeric, 0)) AS total_usd,
  COUNT(DISTINCT run_id) AS run_count
FROM relay_events
WHERE event_name = 'budget.committed'
GROUP BY tenant_id, month;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_monthly_spend_pk
  ON tenant_monthly_spend (tenant_id, month);

COMMENT ON MATERIALIZED VIEW tenant_monthly_spend IS
  'Phase 53: per-tenant month-to-date USD spend aggregated from budget.committed Relay events. Refreshed nightly by the applyMonthlyCostRollup Inngest function. Use tenant_month_to_date_usd() for live (un-refreshed) reads.';

-- Helper function for live month-to-date queries (no view refresh needed).
-- Used by the chat-dispatch budget gate where stale data could let a run
-- through after the cap was already breached.
CREATE OR REPLACE FUNCTION tenant_month_to_date_usd(p_tenant_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM((payload->>'amount_usd')::numeric), 0)
  FROM relay_events
  WHERE tenant_id = p_tenant_id
    AND event_name = 'budget.committed'
    AND occurred_at >= date_trunc('month', now());
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION tenant_month_to_date_usd IS
  'Phase 53: live tenant month-to-date USD spend. Sums budget.committed events for the current calendar month. Used by the chat-dispatch budget gate where freshness matters more than view efficiency.';
