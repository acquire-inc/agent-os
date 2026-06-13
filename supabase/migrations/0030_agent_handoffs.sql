-- Migration 0030: async A2A handoff chains (V2 P7).
--
-- A handoff is one agent finishing its step and queuing the next run on
-- another agent, with correlation/causation tracking so the operator can
-- view the chain. The decision lives in packages/core/src/a2a.ts; this
-- migration adds the table that records every queued handoff for the
-- audit trail + the dashboard.
--
-- Rollback: docs/migration-rollback-notes.md §0030.

CREATE TABLE IF NOT EXISTS agent_handoffs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Causation: the run that produced the trigger.
  from_run_id       UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  from_agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  -- Target: the receiving agent + the new run.
  to_agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  next_run_id       UUID REFERENCES runs(id) ON DELETE SET NULL,
  -- Correlation: ties to the parent objective when there is one.
  objective_id      UUID REFERENCES objectives(id) ON DELETE SET NULL,
  summary           TEXT NOT NULL DEFAULT '',
  artifact_refs     JSONB NOT NULL DEFAULT '[]',
  warning           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_handoffs IS
  'V2 P7: async A2A handoff records. Each row links a from-run + from-agent to a to-agent + next-run, optionally tied to an objective for chain correlation. Cross-tenant handoff is refused at the application layer (a2a.ts decideHandoff) and would also fail RLS here.';

CREATE INDEX IF NOT EXISTS agent_handoffs_objective_idx
  ON agent_handoffs (objective_id, created_at DESC)
  WHERE objective_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_handoffs_from_run_idx
  ON agent_handoffs (from_run_id);
CREATE INDEX IF NOT EXISTS agent_handoffs_to_agent_idx
  ON agent_handoffs (to_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_handoffs_tenant_idx
  ON agent_handoffs (tenant_id);

ALTER TABLE agent_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_handoffs_select_own_tenant ON agent_handoffs;
CREATE POLICY agent_handoffs_select_own_tenant ON agent_handoffs
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS agent_handoffs_modify_own_tenant ON agent_handoffs;
CREATE POLICY agent_handoffs_modify_own_tenant ON agent_handoffs
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );
