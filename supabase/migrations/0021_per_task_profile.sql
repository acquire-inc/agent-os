-- Migration 0021: per-skill / per-tool task profile JSON.
--
-- Phase 40. Phase 32 added `preferred_model_tier` for per-task model fork
-- via the tier router. This migration adds the richer `task_profile`
-- JSONB so skills and tools can declare the actual capability profile
-- they care about — and the intelligent picker (Phase 39) ranks the
-- whole catalog against that profile instead of just picking a tier.
--
-- Shape mirrors the TaskProfile TypeScript interface in
-- packages/core/src/router/intelligence.ts:
--   { capabilities: { reasoning: 1, tool_use: 0.5, summarization: 1 },
--     requires: { tools: true, minContextTokens: 100000 },
--     costSensitivity: "medium",
--     qualityFloor: 7 }
--
-- NULL or empty {} = no profile; the tier-based fork (Phase 32) applies.
-- preferred_model_tier is still honored as a tier hint when task_profile
-- is absent — the two columns are complementary.

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS task_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS task_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN skills.task_profile IS
  'Phase 40: capability profile for the intelligent model picker. Shape mirrors TaskProfile in packages/core/src/router/intelligence.ts. Empty {} = no profile; the tier-based fork applies instead.';

COMMENT ON COLUMN tools.task_profile IS
  'Phase 40: capability profile for the intelligent model picker. Same shape as skills.task_profile.';

-- Seed canonical profiles for the high-traffic skills.
-- The picker reads these at run start (per-skill) and at dispatch (per-tool).
UPDATE skills SET task_profile = '{
  "capabilities": { "reasoning": 1, "summarization": 1, "factuality": 0.5 },
  "costSensitivity": "medium",
  "qualityFloor": 7
}'::jsonb WHERE key = 'briefing-synthesis';

UPDATE skills SET task_profile = '{
  "capabilities": { "code_generation": 1, "reasoning": 0.5, "tool_use": 0.5 },
  "costSensitivity": "low",
  "qualityFloor": 8
}'::jsonb WHERE key = 'output-quality-gate';

UPDATE skills SET task_profile = '{
  "capabilities": { "summarization": 1, "tool_use": 1, "multilingual": 0.5 },
  "costSensitivity": "medium"
}'::jsonb WHERE key IN ('client-onboarding', 'weekly-client-reporting');

UPDATE skills SET task_profile = '{
  "capabilities": { "classification": 1, "tool_use": 0.5 },
  "costSensitivity": "high"
}'::jsonb WHERE key IN ('connector-health', 'morning-vitals', 'churn-risk-detection', 'margin-alerts');

UPDATE skills SET task_profile = '{
  "capabilities": { "summarization": 1, "reasoning": 0.5 },
  "costSensitivity": "high"
}'::jsonb WHERE key = 'meeting-prep';

UPDATE skills SET task_profile = '{
  "capabilities": { "reasoning": 1, "summarization": 0.5 },
  "costSensitivity": "low",
  "qualityFloor": 8
}'::jsonb WHERE key IN ('adversarial-offer-critique', 'cole-gordon-mechanism', 'hormozi-offer-construction', 'guarantee-design');

UPDATE skills SET task_profile = '{
  "capabilities": { "summarization": 1, "tool_use": 0.5, "long_context": 0.5 },
  "costSensitivity": "medium"
}'::jsonb WHERE key = 'content-engine';

UPDATE skills SET task_profile = '{
  "capabilities": { "code_generation": 1, "reasoning": 0.5 },
  "costSensitivity": "medium"
}'::jsonb WHERE key = 'creative-generation';

UPDATE skills SET task_profile = '{
  "capabilities": { "summarization": 1, "tool_use": 0.5 },
  "costSensitivity": "medium"
}'::jsonb WHERE key = 'proposal-drafting';

UPDATE skills SET task_profile = '{
  "capabilities": { "classification": 1 },
  "costSensitivity": "high"
}'::jsonb WHERE key IN ('expense-categorization', 'naming-convention');

-- Per-tool profiles.
-- tool.browser: scraped pages benefit from long context + summarization,
-- low latency desirable (operators don't want a 30s scrape-then-think).
UPDATE tools SET task_profile = '{
  "capabilities": { "long_context": 1, "summarization": 1, "factuality": 0.5 },
  "requires": { "minContextTokens": 100000 },
  "costSensitivity": "medium"
}'::jsonb WHERE key = 'tool.browser';

-- tool.rls-test: deterministic; classification-light is fine.
UPDATE tools SET task_profile = '{
  "capabilities": { "classification": 1 },
  "costSensitivity": "high"
}'::jsonb WHERE key = 'tool.rls-test';
