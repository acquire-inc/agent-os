-- Migration 0026: objective-driven reflexion retry loop (V2 P3).
--
-- An objective is a durable, multi-run target ("close out the Q3 ad-spend audit")
-- that lives across attempts of the same agent. When a run fails, the reflexion
-- runner (packages/core/src/objective.ts) decides whether to queue a follow-up
-- attempt with prior failure context carried over, or abandon and surface for
-- human intervention.
--
-- Adds:
--   1. objectives table — one row per durable target. Status active → completed |
--      abandoned. max_attempts bounds the retry loop (default 3).
--   2. runs.objective_id (nullable) — links a run to its objective so the
--      reflexion runner can find prior attempts. Single-shot dispatches keep
--      objective_id NULL (back-compat: every existing run row is treated as
--      objective-less and skipped by the reflexion hook).
--   3. runs.attempt_number (default 1) — 1-indexed attempt within the objective.
--      Used by the runner to order prior attempts when composing reflexion
--      context.
--   4. RLS — tenant-scoped on objectives, mirroring the rest of the schema.

CREATE TABLE IF NOT EXISTS objectives (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'completed', 'abandoned')),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ
);

COMMENT ON TABLE objectives IS
  'V2 P3: durable multi-run target for an agent. Reflexion loop carries failure context across attempts up to max_attempts; status transitions to completed on verified success or abandoned at the cap.';

CREATE INDEX IF NOT EXISTS objectives_tenant_id_idx ON objectives (tenant_id);
CREATE INDEX IF NOT EXISTS objectives_agent_id_status_idx ON objectives (agent_id, status);

-- Link runs to objectives so the reflexion runner can load prior attempts and
-- so attempt_number gives a stable order. Nullable + default 1 keeps every
-- existing row valid (back-compat).
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS objective_id UUID
    REFERENCES objectives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN runs.objective_id IS
  'V2 P3: parent objective if this run is one attempt of a multi-run target. NULL for single-shot dispatches.';
COMMENT ON COLUMN runs.attempt_number IS
  'V2 P3: 1-indexed attempt within the parent objective. Always 1 for objective-less runs.';

CREATE INDEX IF NOT EXISTS runs_objective_id_attempt_idx
  ON runs (objective_id, attempt_number)
  WHERE objective_id IS NOT NULL;

-- RLS: scope objectives by tenant. Mirrors the agents/runs policies.
ALTER TABLE objectives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS objectives_select_own_tenant ON objectives;
CREATE POLICY objectives_select_own_tenant ON objectives
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS objectives_modify_own_tenant ON objectives;
CREATE POLICY objectives_modify_own_tenant ON objectives
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
