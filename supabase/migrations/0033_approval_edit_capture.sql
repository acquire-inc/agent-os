-- Migration 0033: operator edit capture on the approvals rail (V3 E1 input).
--
-- The exemplar learning loop (packages/core/src/exemplar.ts) treats an
-- operator EDIT as the richest label: the operator's version is the better
-- answer and becomes the positive exemplar. Until now the approvals rail
-- could only record WHICH option was chosen — the correction itself was
-- uncapturable. Two additive columns:
--
--   decided_option_key  what the operator chose (was only in run_activity prose)
--   operator_text       the operator's replacement text when they edited the
--                        proposed action before approving. NULL = no edit.
--
-- Exemplar mapping (ExemplarSink.loadDecisions):
--   status=decided AND operator_text IS NOT NULL          → decision='edited'
--   status=decided AND decided_option_key NOT IN deny set → decision='approved'
--   status=decided AND decided_option_key IN ('none','deny','reject')
--                                                          → decision='rejected'
--
-- Rollback: ALTER TABLE approvals DROP COLUMN IF EXISTS decided_option_key,
--           DROP COLUMN IF EXISTS operator_text;

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS decided_option_key TEXT,
  ADD COLUMN IF NOT EXISTS operator_text TEXT;

COMMENT ON COLUMN approvals.decided_option_key IS
  'V3 E1: the option key the operator chose at decide time. Structured (was previously only in run_activity prose).';
COMMENT ON COLUMN approvals.operator_text IS
  'V3 E1: the operator''s corrected/replacement text when they edited the proposed action before approving. The exemplar harvest treats this as the positive exemplar (the edit is the operator teaching). NULL = decided without edit.';
