-- Migration 0017: per-tenant scorecard threshold overrides.
--
-- Phase 27: lets operators tune Phase 18's ScorecardThresholds per tenant
-- without changing code. Empty {} = use the DEFAULT_THRESHOLDS verbatim.
-- Partial overrides supported (e.g. just `minSampleSize: 5` for the
-- agent-onboarder tight cycle the doctrine mentions).
--
-- The scheduled scorecard job merges DEFAULT_THRESHOLDS with this jsonb
-- on each per-agent score pass.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS scorecard_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.scorecard_thresholds IS
  'Phase 27: partial ScorecardThresholds override. Shape matches the TypeScript ScorecardThresholds interface; missing keys fall back to DEFAULT_THRESHOLDS. Examples: {"minSampleSize": 5} for agent-onboarder tight cycle; {"minApprovalRateForPromote": 0.85} for a tenant that wants a looser promote bar.';
