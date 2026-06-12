-- Migration 0028: critic-agent peer-approval (V2 P6).
--
-- Trusted agents (scorecard-earned) vote on low-stakes proposals; a clean
-- quorum (default 2 approvals, zero rejections) auto-approves. ANY rejection
-- escalates to the human inbox. Can't-fail proposers are never critic-
-- decidable (enforced in packages/core/src/critic.ts isCriticEligible —
-- defense-in-depth note below).
--
-- Adds:
--   1. critic_votes — one row per (approval, critic) vote. UNIQUE constraint
--      means a critic's re-vote UPDATEs (latest verdict wins, matching
--      tallyCriticVotes semantics).
--   2. approvals.decided_via — 'human' (default) | 'critic_quorum'. The
--      audit answer to "who approved this — a person or the peer layer?"
--   3. approvals.escalated — set when a critic rejection bounced the
--      proposal back to the human inbox (it stays open; the flag is the
--      "a peer flagged this" signal for the UI).

CREATE TABLE IF NOT EXISTS critic_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  critic_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('approve', 'reject')),
  rationale TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT critic_votes_one_per_critic UNIQUE (approval_id, critic_agent_id)
);

COMMENT ON TABLE critic_votes IS
  'V2 P6: peer votes on low-stakes proposals. Quorum approval (zero rejections) auto-decides via runCriticReview; any rejection escalates to the human inbox. Can''t-fail proposers are never critic-decidable; self-votes are ignored at tally time.';

CREATE INDEX IF NOT EXISTS critic_votes_approval_idx ON critic_votes (approval_id);
CREATE INDEX IF NOT EXISTS critic_votes_tenant_idx ON critic_votes (tenant_id);

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS decided_via TEXT NOT NULL DEFAULT 'human'
    CHECK (decided_via IN ('human', 'critic_quorum')),
  ADD COLUMN IF NOT EXISTS escalated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN approvals.decided_via IS
  'V2 P6: ''human'' for operator decisions (default; all existing rows), ''critic_quorum'' when the peer layer auto-approved. Can''t-fail proposals are always human.';
COMMENT ON COLUMN approvals.escalated IS
  'V2 P6: true when a critic rejection bounced this proposal back to the human inbox. The approval stays open; this flag surfaces "a peer flagged this" in the UI.';

-- RLS: tenant-scoped, mirroring objectives (0026) / improvement proposals (0027).
ALTER TABLE critic_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS critic_votes_select_own_tenant ON critic_votes;
CREATE POLICY critic_votes_select_own_tenant ON critic_votes
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS critic_votes_modify_own_tenant ON critic_votes;
CREATE POLICY critic_votes_modify_own_tenant ON critic_votes
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
