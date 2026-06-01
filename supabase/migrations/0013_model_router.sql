-- 0013_model_router.sql
-- Step 2.5 / Model Router: declarative tier intent + per-tenant tier overrides.
--
-- "Hermes" the operator means is the ROUTER, not a model slug. Models are
-- interchangeable fuel; the router picks per task class. This migration adds
-- the schema surface:
--   • agents.model_tier — declared tier intent (T-trivial..T-critical).
--                          The resolved model still lands in agents.model
--                          (the runner dispatches against that — no runtime
--                          routing layer, no decision latency).
--   • tenants.tier_overrides — per-tier override jsonb. Replaces the blunt
--                              tenants.default_model_override mechanism. The
--                              legacy column stays (back-compat) but is now
--                              deprecated in favor of the per-tier map.
--
-- Defaults live in packages/core/src/router/tier-models.ts (DEFAULT_TIER_MODELS).
-- Operator updates to defaults ship via PR; per-tenant overrides ship via the
-- SPA / API by editing tenants.tier_overrides.
--
-- T-critical agents are EXEMPT from tier_overrides (Open Q #1 RESOLVED).
-- resolveModel() enforces this at seed time; the runtime cantfail.model_violation
-- assertion enforces it at dispatch. Both must agree.
--
-- Backfill: agents.model_tier is populated from agents.model via the
-- tierFromLegacyModel() heuristic. Existing rows get their tier classified
-- in this migration; future seedAgent calls set both fields explicitly.

-- ------------------------------------------------------------------------
-- agents.model_tier — declared tier intent.
-- ------------------------------------------------------------------------
alter table agents
  add column if not exists model_tier text
    check (model_tier in ('T-trivial','T-cheap','T-reason','T-work','T-critical'));

-- Backfill from the existing model literals — same heuristic as
-- packages/core/src/router/tier-models.ts tierFromLegacyModel().
update agents set model_tier = case
  when model = 'anthropic/claude-opus-4.8'             then 'T-critical'
  when model = 'anthropic/claude-sonnet-4.6'           then 'T-work'
  when model = 'anthropic/claude-haiku-4-5'            then 'T-work'
  when model = 'nousresearch/hermes-4-405b'            then 'T-reason'
  when model = 'nousresearch/hermes-4-70b'             then 'T-cheap'
  when model = 'nousresearch/hermes-2-pro-llama-3-8b'  then 'T-trivial'
  else 'T-work'  -- safe non-critical default for unknown literals
end
where model_tier is null;

-- ------------------------------------------------------------------------
-- tenants.tier_overrides — per-tier per-tenant override jsonb.
-- Shape: { "T-cheap": "deepseek/deepseek-v3", "T-reason": "nousresearch/hermes-4-405b" }
-- An empty {} (the default) means "use DEFAULT_TIER_MODELS for every tier."
-- T-critical is NEVER honored from this column — resolveModel() ignores it
-- and the runtime cantfail.model_violation assertion fail-closes any drift.
-- ------------------------------------------------------------------------
alter table tenants
  add column if not exists tier_overrides jsonb not null default '{}'::jsonb;

-- Migration-time note for operators: tenants.default_model_override is
-- DEPRECATED in favor of tenants.tier_overrides. The seedAgent code still
-- reads default_model_override as a legacy fallback (blunt instrument:
-- applies to all non-critical tiers) but logs a deprecation warning. New
-- operator workflows should set tier_overrides[T-cheap|T-reason|T-work]
-- explicitly. The legacy column is not dropped — back-compat for any
-- automation that still writes to it.
comment on column tenants.default_model_override is
  'DEPRECATED — use tenants.tier_overrides for per-tier control. This blunt-instrument column applies to all non-critical tiers when set; tier_overrides wins when both are present.';

-- ------------------------------------------------------------------------
-- Rollback (operator-only — destructive):
--   alter table tenants drop column if exists tier_overrides;
--   alter table agents drop column if exists model_tier;
-- ------------------------------------------------------------------------
