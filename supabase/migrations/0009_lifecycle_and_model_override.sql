-- 0009_lifecycle_and_model_override.sql
--
-- Two platform primitives for autonomous-team operation:
--
-- 1. agents.lifecycle_state — richer than the boolean `enabled`. A team manager
--    agent transitions agents through draft → active → paused → archived without
--    deleting rows. The runner checks both enabled AND lifecycle_state='active'
--    before claiming work.
--
-- 2. tenants.default_model_override — when set, every seedAgent call for this
--    tenant rewrites spec.model to the override at insert/update time. Lets a
--    tenant standardize on a single model (e.g. hermes-4-405b) without modifying
--    the per-agent script literals — the doctrine defaults stay intact and the
--    override is reversible by clearing this column + re-running seed.
--
-- Migration 0009 (Phase 8.5 — autonomous-team primitives).

alter table tenants
  add column if not exists default_model_override text;

alter table agents
  add column if not exists lifecycle_state text not null default 'active'
    check (lifecycle_state in ('draft', 'active', 'paused', 'archived'));

create index if not exists agents_tenant_lifecycle_idx
  on agents (tenant_id, lifecycle_state);

-- ----------------------------------------------------------------------------
-- ROLLBACK (per VALIDATION.md Nyquist dim 8):
--   drop index if exists agents_tenant_lifecycle_idx;
--   alter table agents drop column if exists lifecycle_state;
--   alter table tenants drop column if exists default_model_override;
-- Existing `enabled` boolean column is untouched; rollback is non-destructive.
-- ----------------------------------------------------------------------------
