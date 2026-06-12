-- Migration 0027: agent self-improvement proposal queue (V2 P4).
--
-- The self-improvement engine (packages/core/src/improve.ts) watches an
-- agent's recurring lessons (memory loop, P2) on the scorecard cadence and
-- proposes prompt amendments — an append-only, bounded "Learned guidance"
-- block. Proposals queue here for operator review, mirroring
-- model_feedback_proposals (0022).
--
-- Apply semantics (enforced in application code, documented here):
--   - Applying a prompt_amend proposal writes a NEW agent_prompts version
--     (is_current flips) — never an in-place edit, so rollback is one flip.
--   - Can't-fail agents (CANT_FAIL_KEYS): requires_human_approval is always
--     true and the auto-apply path MUST skip them regardless of tenant
--     auto-apply opt-ins. Same doctrine as model overrides: tier wins.
--   - status='superseded' marks proposals replaced by a newer cycle before
--     review.

CREATE TABLE IF NOT EXISTS agent_improvement_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prompt_amend', 'skill_add', 'skill_remove')),
  -- prompt_amend: full proposed prompt text (base + replaced guidance block).
  proposed_prompt TEXT,
  -- skill_add / skill_remove: the skill key in question.
  skill_key TEXT,
  evidence JSONB NOT NULL DEFAULT '[]',
  sample_size INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  requires_human_approval BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'rejected', 'superseded')),
  applied_at TIMESTAMPTZ,
  applied_by TEXT,
  -- When applied, the agent_prompts row created from this proposal — the
  -- audit link "this prompt version came from this proposal".
  applied_prompt_version_id UUID REFERENCES agent_prompts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_improvement_proposals IS
  'V2 P4: pending and historical self-improvement proposals (prompt amendments, skill composition changes) produced by runSelfImprovement from recurring memory-loop lessons. Operator reviews before apply; can''t-fail agents are never auto-applied.';

CREATE INDEX IF NOT EXISTS agent_improvement_proposals_pending_idx
  ON agent_improvement_proposals (created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agent_improvement_proposals_agent_idx
  ON agent_improvement_proposals (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_improvement_proposals_tenant_idx
  ON agent_improvement_proposals (tenant_id);

-- RLS: tenant-scoped, mirroring objectives (0026).
ALTER TABLE agent_improvement_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_improvement_proposals_select_own_tenant ON agent_improvement_proposals;
CREATE POLICY agent_improvement_proposals_select_own_tenant ON agent_improvement_proposals
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS agent_improvement_proposals_modify_own_tenant ON agent_improvement_proposals;
CREATE POLICY agent_improvement_proposals_modify_own_tenant ON agent_improvement_proposals
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
