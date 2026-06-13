-- Migration 0031: autonomous manager proposals (V2 P8).
--
-- Pure decisions live in packages/core/src/manager.ts. This migration adds
-- the operator-reviewed proposal queue mirroring agent_improvement_proposals
-- (0027). Same status lifecycle: pending → applied | rejected | superseded.
-- Operator reviews before any pause/retire is actually written to agents.
--
-- Rollback: docs/migration-rollback-notes.md §0031.

CREATE TABLE IF NOT EXISTS manager_proposals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('pause', 'retire')),
  rationale    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'applied', 'rejected', 'superseded')),
  applied_at   TIMESTAMPTZ,
  applied_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE manager_proposals IS
  'V2 P8: pending and historical autonomous-manager proposals (pause / retire). Operator reviews before apply; cant-fail agents never appear here (refused at decideManagerAction).';

CREATE INDEX IF NOT EXISTS manager_proposals_pending_idx
  ON manager_proposals (created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS manager_proposals_agent_idx
  ON manager_proposals (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manager_proposals_tenant_idx
  ON manager_proposals (tenant_id);

ALTER TABLE manager_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manager_proposals_select_own_tenant ON manager_proposals;
CREATE POLICY manager_proposals_select_own_tenant ON manager_proposals
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS manager_proposals_modify_own_tenant ON manager_proposals;
CREATE POLICY manager_proposals_modify_own_tenant ON manager_proposals
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
