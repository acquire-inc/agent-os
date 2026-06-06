-- Migration 0020: model catalog with cost + capability metadata.
--
-- Phase 38. The Model Router currently maps tier intent (T-cheap / T-work
-- / etc.) to a single canonical model. That gets agents up and running but
-- it isn't "intelligent" — there's no per-task model selection that
-- balances capability vs. cost.
--
-- This migration adds the data layer the intelligence sits on:
--   - Per-model cost (input + output per million tokens)
--   - Per-model capability scores by canonical task category
--   - Hard capabilities (context window, tool support, vision, etc.)
--   - Tier affinity (which tier this model is canonical for, when used
--     by the legacy tier-based router)
--
-- The scoring algorithm (pickBestModel, Phase 39) reads these rows and
-- ranks candidates by value-per-dollar against a task profile. The
-- operator's stated logic — "if 9-quality is cheaper than 10-quality,
-- pick the 9" — emerges naturally from value scoring.
--
-- Refresh: model pricing moves. The `last_observed_at` column lets a
-- future operator agent (model-catalog-curator) refresh this table
-- against live provider docs.

CREATE TABLE IF NOT EXISTS models (
  slug TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  family TEXT NOT NULL,
  generation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preferred'
    CHECK (status IN ('preferred', 'secondary', 'deprecated', 'experimental')),
  -- Cost in USD per million tokens. Input is typically cheaper than output.
  cost_input_per_million_usd NUMERIC(12, 4) NOT NULL,
  cost_output_per_million_usd NUMERIC(12, 4) NOT NULL,
  -- Hard capabilities.
  context_window_tokens INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  supports_tools BOOLEAN NOT NULL DEFAULT TRUE,
  supports_reasoning BOOLEAN NOT NULL DEFAULT FALSE,
  supports_vision BOOLEAN NOT NULL DEFAULT FALSE,
  supports_streaming BOOLEAN NOT NULL DEFAULT TRUE,
  -- Per-task capability scores 0..10. Shape:
  --   { reasoning: <0-10>, tool_use: <0-10>, classification: <0-10>,
  --     summarization: <0-10>, code_generation: <0-10>, multilingual: <0-10>,
  --     vision: <0-10>, long_context: <0-10>, factuality: <0-10>,
  --     latency_sensitivity: <0-10> }
  -- A score of NULL or absent key means "not measured" (the scorer
  -- treats absent as a neutral 5).
  capability_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Tier this model is canonical for under the legacy tier-based router.
  -- NULL means "no tier affinity" — only the intelligent picker uses it.
  tier_affinity TEXT
    CHECK (tier_affinity IS NULL OR tier_affinity IN (
      'T-trivial', 'T-cheap', 'T-reason', 'T-work', 'T-critical'
    )),
  -- Optional latency hint for fast-pick tasks.
  latency_p50_ms INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS models_provider_idx ON models (provider);
CREATE INDEX IF NOT EXISTS models_tier_affinity_idx ON models (tier_affinity)
  WHERE tier_affinity IS NOT NULL;
CREATE INDEX IF NOT EXISTS models_enabled_idx ON models (enabled);

COMMENT ON TABLE models IS
  'Phase 38: model catalog. Powers the intelligent picker (Phase 39) which scores candidates by value-per-dollar against a task profile. Operators tune capability_scores and cost columns as new models ship.';

COMMENT ON COLUMN models.capability_scores IS
  'Per-task capability scores 0..10. Canonical keys: reasoning, tool_use, classification, summarization, code_generation, multilingual, vision, long_context, factuality, latency_sensitivity. Missing keys default to neutral 5 in the scorer.';

-- Seed the current canonical models (June 2026). Operators tune as
-- pricing/capability data shifts.
--
-- Costs are illustrative USD per 1M tokens; verify against provider docs
-- before relying on them for production billing decisions.
--
-- Capability scores reflect AgentOS's domain intuition (not a benchmark):
--   - reasoning: multi-step planning / synthesis
--   - tool_use: function calling reliability + structured output
--   - classification: binary/multi-class decisions
--   - summarization: condensing long text
--   - code_generation: writing + editing code
--   - factuality: low hallucination on grounded prompts
--   - long_context: handling 100k+ token windows
--   - latency_sensitivity: how good for sub-2s response use cases

INSERT INTO models (slug, provider, family, generation, status,
  cost_input_per_million_usd, cost_output_per_million_usd,
  context_window_tokens, max_output_tokens,
  supports_tools, supports_reasoning, supports_vision, supports_streaming,
  capability_scores, tier_affinity) VALUES

-- Anthropic Claude family (load-bearing for T-critical + T-work)
('anthropic/claude-opus-4.8', 'anthropic', 'claude-opus', '4.8', 'preferred',
  15.00, 75.00, 200000, 8192, TRUE, TRUE, TRUE, TRUE,
  '{"reasoning": 10, "tool_use": 10, "classification": 9, "summarization": 10, "code_generation": 10, "multilingual": 9, "vision": 9, "long_context": 10, "factuality": 10, "latency_sensitivity": 4}'::jsonb,
  'T-critical'),
('anthropic/claude-sonnet-4.6', 'anthropic', 'claude-sonnet', '4.6', 'preferred',
  3.00, 15.00, 200000, 8192, TRUE, TRUE, TRUE, TRUE,
  '{"reasoning": 9, "tool_use": 10, "classification": 9, "summarization": 9, "code_generation": 9, "multilingual": 9, "vision": 9, "long_context": 9, "factuality": 9, "latency_sensitivity": 7}'::jsonb,
  'T-work'),
('anthropic/claude-haiku-4-5', 'anthropic', 'claude-haiku', '4-5', 'preferred',
  0.80, 4.00, 200000, 8192, TRUE, FALSE, TRUE, TRUE,
  '{"reasoning": 7, "tool_use": 9, "classification": 8, "summarization": 8, "code_generation": 7, "multilingual": 8, "vision": 7, "long_context": 9, "factuality": 8, "latency_sensitivity": 9}'::jsonb,
  NULL),

-- Nous Hermes family (T-cheap volume + T-reason workhorse)
('nousresearch/hermes-4-405b', 'nousresearch', 'hermes', '4-405b', 'preferred',
  3.00, 9.00, 128000, 8192, TRUE, FALSE, FALSE, TRUE,
  '{"reasoning": 9, "tool_use": 7, "classification": 8, "summarization": 9, "code_generation": 7, "multilingual": 7, "vision": 0, "long_context": 8, "factuality": 8, "latency_sensitivity": 6}'::jsonb,
  'T-reason'),
('nousresearch/hermes-4-70b', 'nousresearch', 'hermes', '4-70b', 'preferred',
  0.40, 1.20, 128000, 8192, TRUE, FALSE, FALSE, TRUE,
  '{"reasoning": 7, "tool_use": 6, "classification": 8, "summarization": 8, "code_generation": 6, "multilingual": 6, "vision": 0, "long_context": 7, "factuality": 7, "latency_sensitivity": 8}'::jsonb,
  'T-cheap'),
('nousresearch/hermes-2-pro-llama-3-8b', 'nousresearch', 'hermes', '2-pro-8b', 'secondary',
  0.10, 0.30, 8192, 4096, TRUE, FALSE, FALSE, TRUE,
  '{"reasoning": 5, "tool_use": 5, "classification": 7, "summarization": 6, "code_generation": 4, "multilingual": 5, "vision": 0, "long_context": 3, "factuality": 6, "latency_sensitivity": 10}'::jsonb,
  'T-trivial'),

-- OpenAI (for comparison / fallback on T-work)
('openai/gpt-4o', 'openai', 'gpt-4o', '4o', 'preferred',
  2.50, 10.00, 128000, 16384, TRUE, FALSE, TRUE, TRUE,
  '{"reasoning": 8, "tool_use": 9, "classification": 9, "summarization": 9, "code_generation": 8, "multilingual": 9, "vision": 9, "long_context": 8, "factuality": 8, "latency_sensitivity": 8}'::jsonb,
  NULL),
('openai/gpt-4o-mini', 'openai', 'gpt-4o-mini', '4o-mini', 'preferred',
  0.15, 0.60, 128000, 16384, TRUE, FALSE, TRUE, TRUE,
  '{"reasoning": 6, "tool_use": 8, "classification": 8, "summarization": 7, "code_generation": 6, "multilingual": 7, "vision": 7, "long_context": 7, "factuality": 7, "latency_sensitivity": 10}'::jsonb,
  NULL),

-- DeepSeek (cost leader on reasoning tasks)
('deepseek/deepseek-v3', 'deepseek', 'deepseek-v3', 'v3', 'preferred',
  0.27, 1.10, 64000, 8192, TRUE, FALSE, FALSE, TRUE,
  '{"reasoning": 8, "tool_use": 7, "classification": 8, "summarization": 8, "code_generation": 9, "multilingual": 7, "vision": 0, "long_context": 6, "factuality": 7, "latency_sensitivity": 7}'::jsonb,
  NULL),

-- Google Gemini (long-context use cases)
('google/gemini-2-pro', 'google', 'gemini-2', 'pro', 'preferred',
  1.25, 5.00, 2000000, 8192, TRUE, TRUE, TRUE, TRUE,
  '{"reasoning": 9, "tool_use": 8, "classification": 8, "summarization": 9, "code_generation": 8, "multilingual": 9, "vision": 9, "long_context": 10, "factuality": 8, "latency_sensitivity": 7}'::jsonb,
  NULL),
('google/gemini-2-flash', 'google', 'gemini-2', 'flash', 'preferred',
  0.075, 0.30, 1000000, 8192, TRUE, FALSE, TRUE, TRUE,
  '{"reasoning": 7, "tool_use": 8, "classification": 8, "summarization": 8, "code_generation": 7, "multilingual": 8, "vision": 8, "long_context": 10, "factuality": 7, "latency_sensitivity": 10}'::jsonb,
  NULL)

ON CONFLICT (slug) DO UPDATE SET
  provider = EXCLUDED.provider,
  family = EXCLUDED.family,
  generation = EXCLUDED.generation,
  status = EXCLUDED.status,
  cost_input_per_million_usd = EXCLUDED.cost_input_per_million_usd,
  cost_output_per_million_usd = EXCLUDED.cost_output_per_million_usd,
  context_window_tokens = EXCLUDED.context_window_tokens,
  max_output_tokens = EXCLUDED.max_output_tokens,
  supports_tools = EXCLUDED.supports_tools,
  supports_reasoning = EXCLUDED.supports_reasoning,
  supports_vision = EXCLUDED.supports_vision,
  supports_streaming = EXCLUDED.supports_streaming,
  capability_scores = EXCLUDED.capability_scores,
  tier_affinity = EXCLUDED.tier_affinity,
  last_observed_at = now();
