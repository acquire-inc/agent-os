-- 0012_run_summaries.sql
-- Phase 10 (Relay P0): the P0 outcome surface per docs/plans/AGENT-OS-PLAN.md §8.2.
--
-- One row per terminal run. Composed at SessionEnd by composeRunSummary()
-- (packages/core/src/relay/summary.ts). This is the gap the plan called
-- out: specced but never built — "emit back what every agent did" lived
-- in the divergent shapes of runs + run_activity + audit_log + autonomy_events.
-- run_summaries is the canonical outcome envelope every operator + downstream
-- consumer (the Pixel SDK, the cross-tenant aggregation view, the
-- agent-evaluator scorecard) reads from.

create table if not exists run_summaries (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy + run identity. UNIQUE on run_id — exactly one summary per run.
  tenant_id         uuid not null references tenants(id) on delete cascade,
  run_id            uuid not null unique references runs(id) on delete cascade,
  agent_id          uuid not null references agents(id) on delete cascade,

  -- Outcome envelope (canonical)
  status            text not null check (status in ('done','failed','escalated','skipped','quarantined')),
  deliverable_kind  text,                          -- 'document' | 'approval_request' | 'tool_action' | 'no_op' | ...
  deliverable_ref   text,                          -- path / uuid / external URI to the deliverable
  evidence_paths    jsonb not null default '[]'::jsonb,   -- list of file paths (CLAUDE.md non-neg #4)

  -- Cost + tokens (commit values — must match runs.cost_usd at SessionEnd; the
  -- composeRunSummary() invariant test asserts cost_actual_usd == runs.cost_usd
  -- per the launch-gate criterion in GENX-PLAN.md §7.1)
  cost_actual_usd   numeric(12,4) not null default 0,
  tokens_in         bigint not null default 0,
  tokens_out        bigint not null default 0,

  -- Activity rollups (counts derived from relay_events for this run_id)
  finding_count     integer not null default 0,    -- security_findings opened during this run
  tool_call_count   integer not null default 0,
  approval_count    integer not null default 0,    -- approvals raised during this run

  -- Denormalized snippet for fast querying without joining the payload jsonb
  summary_text      text,                          -- the one-paragraph human-readable summary
  highlights        jsonb not null default '{}'::jsonb,  -- key fields the agent class wants exposed

  -- Time
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  duration_ms       integer not null,

  -- Privacy posture (mirrors the run's consent for fast aggregation queries
  -- without re-joining relay_events)
  consent_scope     text not null default 'tenant_only'
                      check (consent_scope in ('tenant_only','cross_tenant_aggregated')),

  created_at        timestamptz not null default now()
);

create index if not exists run_summaries_tenant_time_idx on run_summaries(tenant_id, ended_at desc);
create index if not exists run_summaries_agent_idx on run_summaries(agent_id);
create index if not exists run_summaries_status_idx on run_summaries(status);

alter table run_summaries enable row level security;
drop policy if exists run_summaries_rw on run_summaries;
create policy run_summaries_rw on run_summaries
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- ------------------------------------------------------------------------
-- Rollback (operator-only — destructive):
--   drop table if exists run_summaries;
-- ------------------------------------------------------------------------
