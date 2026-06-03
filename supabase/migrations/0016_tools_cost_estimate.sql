-- Migration 0016: per-tool cost estimate column.
--
-- Phase 26 (per-tool reserve/commit). The runner's custom-tool dispatch
-- path now reserves the tool's estimated cost via BudgetTracker before
-- invoking the handler, then commits the actual cost after the result.
-- A reserve that would breach agents.budgetCapUsd is refused — the
-- tool call does not run; the runner surfaces a budget.cap_breached
-- event and (when wired) an operator Approval.
--
-- Default 0 = "free / no estimate". A 0-cost tool still goes through
-- reserve(0) -> commit(0) -> emit budget.reserved / budget.committed
-- so the audit trail is complete; the breach math is a no-op for it.

ALTER TABLE tools
  ADD COLUMN IF NOT EXISTS cost_estimate_usd NUMERIC(12, 4) NOT NULL DEFAULT '0';

COMMENT ON COLUMN tools.cost_estimate_usd IS
  'Phase 26: estimated USD cost per invocation. Used by the runner to reserve before dispatch and commit after; cap breaches refuse the call. 0 = free/no estimate.';

-- Seed canonical estimates for the deterministic tools that exist today.
-- Operators tune these as actual cost data accrues.
UPDATE tools SET cost_estimate_usd = '0.10' WHERE key = 'tool.browser';
UPDATE tools SET cost_estimate_usd = '0.00' WHERE key = 'tool.rls-test';
UPDATE tools SET cost_estimate_usd = '0.00' WHERE key = 'tool.vault-rotate';
UPDATE tools SET cost_estimate_usd = '0.00' WHERE key = 'tool.access-audit';
UPDATE tools SET cost_estimate_usd = '0.00' WHERE key = 'tool.access-log-analyzer';
