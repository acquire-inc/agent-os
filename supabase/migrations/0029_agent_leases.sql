-- Migration 0029: agent lease arbitration (I-003).
--
-- Sequencing layer on top of dispatch: a target resource (lead, deal,
-- objective, connector record, tool invocation, …) is HELD by exactly one
-- agent run at a time via a lease. A second agent asking for the same lease
-- while it's held gets a CONFLICT decision (packages/core/src/lease.ts
-- requestLease) — the runner caller chooses yield / queue / preempt.
--
-- Schema:
--   1. agent_leases — one row per acquire. released_at IS NULL means active.
--      target_kind/target_key are deliberately strings: any future resource
--      type participates without a schema change.
--   2. UNIQUE partial index on (tenant_id, target_kind, target_key) WHERE
--      released_at IS NULL — DB-side enforcement that there is at most one
--      active lease per target per tenant. The preempt path in lease.ts
--      releases the prior lease BEFORE inserting the new one (tested in
--      lease.test.ts ordering invariant); this index is the safety net if
--      that ordering ever drifts.
--
-- Rollback:
--   DROP INDEX IF EXISTS agent_leases_one_active_per_target;
--   DROP TABLE IF EXISTS agent_leases;

CREATE TABLE IF NOT EXISTS agent_leases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_kind     TEXT NOT NULL,
  target_key      TEXT NOT NULL,
  owner_agent_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_run_id    UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  owner_is_cant_fail BOOLEAN NOT NULL DEFAULT false,
  acquired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  released_at     TIMESTAMPTZ,
  CONSTRAINT agent_leases_expires_after_acquired CHECK (expires_at > acquired_at)
);

COMMENT ON TABLE agent_leases IS
  'I-003: lease arbitration so two agents do not act on the same target resource simultaneously. Active leases have released_at IS NULL. Pure decisions live in packages/core/src/lease.ts.';

-- The one-active-per-target invariant. Tenant-scoped because the (kind, key)
-- namespace is per-tenant (one tenant's "lead/L-1" is unrelated to another's).
CREATE UNIQUE INDEX IF NOT EXISTS agent_leases_one_active_per_target
  ON agent_leases (tenant_id, target_kind, target_key)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_leases_owner_run_idx
  ON agent_leases (owner_run_id);
CREATE INDEX IF NOT EXISTS agent_leases_expiry_idx
  ON agent_leases (expires_at)
  WHERE released_at IS NULL;

-- RLS: tenant-scoped, mirroring objectives (0026) / agent_improvement_proposals (0027) / critic_votes (0028).
ALTER TABLE agent_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_leases_select_own_tenant ON agent_leases;
CREATE POLICY agent_leases_select_own_tenant ON agent_leases
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS agent_leases_modify_own_tenant ON agent_leases;
CREATE POLICY agent_leases_modify_own_tenant ON agent_leases
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
