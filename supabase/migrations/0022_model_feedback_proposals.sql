-- Migration 0022: model feedback proposals queue.
--
-- Phase 45. The aggregator (Phase 44) produces ProposedScoreUpdate[] each
-- cycle. We persist them here for two reasons:
--   1. The operator dashboard surfaces pending proposals before they're
--      applied to models.capability_scores. Operator can override or
--      reject anything that looks wrong.
--   2. Audit trail: we can answer "why did this model's reasoning score
--      drop from 9 to 8.7 in May" by reading the proposal row.
--
-- applied_at = NULL means pending operator review (or pending the next
-- auto-apply cycle if the operator opted into auto-apply for this model).
-- applied_at set means the proposal was either written back to models
-- (status='applied') or rejected (status='rejected') or superseded by a
-- newer proposal (status='superseded').

CREATE TABLE IF NOT EXISTS model_feedback_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_slug TEXT NOT NULL REFERENCES models(slug) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  current_score NUMERIC(4, 2) NOT NULL,
  observed_score NUMERIC(4, 2) NOT NULL,
  proposed_score NUMERIC(4, 2) NOT NULL,
  sample_size INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'rejected', 'superseded')),
  applied_at TIMESTAMPTZ,
  applied_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_feedback_proposals_pending_idx
  ON model_feedback_proposals (created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS model_feedback_proposals_model_idx
  ON model_feedback_proposals (model_slug, capability, created_at DESC);

COMMENT ON TABLE model_feedback_proposals IS
  'Phase 45: pending and historical proposed updates to models.capability_scores produced by aggregateModelObservations. Operator reviews before write-back; the auto-apply Inngest function only applies proposals with status=pending whose sample_size and movement clear the auto-apply guardrails.';
