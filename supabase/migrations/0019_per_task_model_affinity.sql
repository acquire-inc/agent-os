-- Migration 0019: per-task model tier affinity.
--
-- Phase 32. The Model Router resolves a single model per agent at seed
-- time. This migration adds per-skill and per-tool model tier preferences
-- so an agent can fork to a different (better-suited) model when invoking
-- a specific skill or tool. The router's existing safety floors still win
-- (T-critical agents always run Opus regardless of preference).
--
-- Default NULL = no preference. The runner falls back to the agent's
-- resolved model in that case.

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS preferred_model_tier TEXT;

ALTER TABLE skills
  ADD CONSTRAINT skills_preferred_model_tier_check
  CHECK (preferred_model_tier IS NULL OR preferred_model_tier IN (
    'T-trivial', 'T-cheap', 'T-reason', 'T-work', 'T-critical'
  ));

ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS preferred_model_tier TEXT;

ALTER TABLE tools
  ADD CONSTRAINT tools_preferred_model_tier_check
  CHECK (preferred_model_tier IS NULL OR preferred_model_tier IN (
    'T-trivial', 'T-cheap', 'T-reason', 'T-work', 'T-critical'
  ));

COMMENT ON COLUMN skills.preferred_model_tier IS
  'Phase 32: when an agent invokes this skill, the router can switch to this tier for the sub-task. T-critical agents ignore the preference (safety floor). NULL = no preference.';

COMMENT ON COLUMN tools.preferred_model_tier IS
  'Phase 32: when an agent invokes this tool, the router can switch to this tier for the sub-task. T-critical agents ignore the preference (safety floor). NULL = no preference.';

-- Seed sensible defaults for existing skills (operators tune later).
-- Reasoning-heavy: deep analysis, synthesis, critique -> T-reason
UPDATE skills SET preferred_model_tier = 'T-reason'
  WHERE key IN (
    'briefing-synthesis',
    'adversarial-offer-critique',
    'cole-gordon-mechanism',
    'hormozi-offer-construction',
    'guarantee-design',
    'output-quality-gate'
  );

-- Tool-orchestration heavy: client-facing content, multi-step tool calls -> T-work
UPDATE skills SET preferred_model_tier = 'T-work'
  WHERE key IN (
    'content-engine',
    'client-onboarding',
    'weekly-client-reporting',
    'creative-generation',
    'proposal-drafting'
  );

-- Volume / triage / templated: monitors, classifiers -> T-cheap
UPDATE skills SET preferred_model_tier = 'T-cheap'
  WHERE key IN (
    'connector-health',
    'morning-vitals',
    'expense-categorization',
    'naming-convention',
    'margin-alerts',
    'churn-risk-detection',
    'meeting-prep'
  );

-- Per-tool seeds. tool.browser: pages can be huge, T-reason handles long
-- context better; tool.rls-test: deterministic, T-cheap fine.
UPDATE tools SET preferred_model_tier = 'T-reason' WHERE key = 'tool.browser';
UPDATE tools SET preferred_model_tier = 'T-cheap' WHERE key = 'tool.rls-test';
