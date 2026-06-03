-- Migration 0018: per-run budget reservation persistence.
--
-- Phase 31. Phase 16's BudgetTracker was an in-memory Map keyed by
-- runId. If the runner restarted mid-run, the in-flight reservations
-- were lost (the committed total survived in runs.cost_usd, but the
-- per-reservation ledger did not). With this table, the tracker can
-- write through and re-hydrate the in-flight state on restart.
--
-- Insert / update / delete pattern (no soft-delete; the table is
-- transient ledger state, not an audit trail — the audit trail lives
-- in relay_events budget.reserved / budget.committed / budget.released).

CREATE TABLE IF NOT EXISTS budget_reservations (
  id TEXT PRIMARY KEY, -- reservation_id from BudgetTracker; "<runId>:r<seq>"
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  amount_usd NUMERIC(12, 4) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS budget_reservations_run_idx
  ON budget_reservations (run_id);

-- RLS — tenant isolation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'is_tenant_member' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'is_tenant_member() function missing — apply migration 0008 first';
  END IF;
END$$;

ALTER TABLE budget_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budget_reservations
  FOR ALL
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

COMMENT ON TABLE budget_reservations IS
  'Phase 31: transient per-run reservation ledger. Rows are deleted on commit/release; the audit trail lives in relay_events budget.reserved / budget.committed / budget.released. Survives runner restart so in-flight reservations can be re-hydrated.';
