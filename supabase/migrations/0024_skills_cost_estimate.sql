-- Migration 0024: per-skill cost estimate column.
--
-- Phase 52. When a skill invocation gets dispatched via the sub-agent
-- path (dispatchSubAgent in apps/runner/src/sub-agent.ts), the BudgetTracker
-- reserves the per-skill estimate before invoking. This mirrors the
-- Phase 26 per-tool reserve pattern: tools.cost_estimate_usd handled
-- direct tool invocation; this handles sub-agent skill invocation.
--
-- Default 0 = "free / no estimate". A 0-cost skill still runs through
-- dispatchSubAgent cleanly (no reserve, no commit, but the audit emit
-- still fires for the model.routed trail).

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS cost_estimate_usd NUMERIC(12, 4) NOT NULL DEFAULT '0';

COMMENT ON COLUMN skills.cost_estimate_usd IS
  'Phase 52: estimated USD cost per invocation when this skill is dispatched as a sub-agent on a forked model. Used by the runner to reserve before sub-agent dispatch. 0 = free/no estimate.';

-- Seed reasonable starting estimates for the heavy-reasoning skills
-- the picker is most likely to fork to expensive models for.
UPDATE skills SET cost_estimate_usd = '0.05'
  WHERE key IN (
    'briefing-synthesis',
    'adversarial-offer-critique',
    'cole-gordon-mechanism',
    'hormozi-offer-construction',
    'guarantee-design',
    'output-quality-gate',
    'proposal-drafting'
  );

UPDATE skills SET cost_estimate_usd = '0.02'
  WHERE key IN (
    'content-engine',
    'client-onboarding',
    'weekly-client-reporting',
    'creative-generation'
  );

-- Triage / classification / monitor skills usually fork to cheap models;
-- keep their estimates low.
UPDATE skills SET cost_estimate_usd = '0.005'
  WHERE key IN (
    'connector-health',
    'morning-vitals',
    'expense-categorization',
    'naming-convention',
    'margin-alerts',
    'churn-risk-detection',
    'meeting-prep'
  );
