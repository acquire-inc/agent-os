-- Migration 0015: fix the agents.model default to the canonical OpenRouter slug.
-- Per CR-06 from the Phase 11-25 aggregate review: the default was
-- "claude-sonnet-4-6" (un-namespaced, hyphenated) which OpenRouter rejects.
-- Canonical slug is "anthropic/claude-sonnet-4.6".
--
-- This migration only changes the default — it does NOT rewrite existing rows.
-- Operators with existing agents on the bad default should re-seed those
-- agents OR run an UPDATE manually after auditing which rows are affected.

ALTER TABLE agents ALTER COLUMN model SET DEFAULT 'anthropic/claude-sonnet-4.6';

COMMENT ON COLUMN agents.model IS
  'OpenRouter slug. Canonical default is anthropic/claude-sonnet-4.6 (T-work tier). T-critical agents pin to anthropic/claude-opus-4.8 via the seed exemption + runtime assertCantFailModel guard.';
