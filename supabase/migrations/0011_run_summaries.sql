-- 0011_run_summaries.sql
-- The run-summary contract (build-spec §3/§5, AGENTS-PLAN.md §2.2). Specced from day one but
-- never built — the biggest gap for "persistent agent memory" + "emit back what every agent did."
-- One structured row per terminal run, captured by the SessionEnd path (setRunStatus). This is
-- the persistent-memory tier (AGENTS-PLAN §1.5) and the future Relay `run.completed` payload.
--
-- runs.summary (free text) stays as the cached one-liner; this table is the structured contract:
--   what_i_did / what_i_produced / what_i_learned / what_next / verification_result.
--
-- RLS: enabled + tenant policy from the start (unlike several older tables — see the RLS-audit
-- gap noted in AGENTS-PLAN §0/§4.2). This is the example new tables should follow.
create table if not exists run_summaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  status text not null,                          -- the terminal status (done|failed|skipped)
  what_i_did text not null default '',
  what_i_produced text not null default '',       -- paths/refs to artifacts, NOT inline blobs
  what_i_learned text not null default '',
  what_next text not null default '',             -- continuity hint for the next run's bundle
  verification_result text not null default '',   -- the self-check outcome
  raw_summary text,                               -- the agent's full summary text, unparsed
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd numeric(12, 4) not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id)                                 -- exactly one summary per run (idempotent)
);
create index if not exists run_summaries_tenant_created_idx on run_summaries (tenant_id, created_at);
create index if not exists run_summaries_agent_idx on run_summaries (agent_id, created_at);

alter table run_summaries enable row level security;
create policy run_summaries_tenant_isolation on run_summaries
  using (is_tenant_member(tenant_id));
