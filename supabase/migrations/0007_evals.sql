-- Eval suites + agent metrics (build-spec §3 `agent_metrics` + the eval-case data model).
-- Phase 8 closes the loop CLAUDE.md promises: "promotion is earned from eval/approval-rate
-- metrics; demotion is automatic on drops." Eval cases are DATA (rows the agent-evaluator
-- replays); metrics are a nightly rollup of runs/approvals/autonomy_events. No per-agent code.

create table eval_cases (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  agent_key   text not null,
  name        text not null,
  input       text not null,
  assertion   text not null,
  kind        text not null default 'output_contains'
                check (kind in ('output_contains','tool_called','no_tool','refusal','manual')),
  severity    text not null default 'normal' check (severity in ('normal','critical')),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, agent_key, name)
);
create index eval_cases_agent_idx on eval_cases(tenant_id, agent_key);

create table agent_metrics (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  agent_id        uuid not null references agents(id) on delete cascade,
  date            date not null,
  runs            integer not null default 0,
  successes       integer not null default 0,
  failures        integer not null default 0,
  success_rate    numeric(5,4) not null default 0,
  approvals_requested integer not null default 0,
  approvals_granted   integer not null default 0,
  approval_rate   numeric(5,4) not null default 0,
  interventions   integer not null default 0,
  cost_usd        numeric(12,4) not null default 0,
  avg_latency_ms  integer not null default 0,
  computed_at     timestamptz not null default now(),
  unique (agent_id, date)
);
create index agent_metrics_agent_idx on agent_metrics(agent_id);

alter table eval_cases enable row level security;
create policy eval_cases_rw on eval_cases
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

alter table agent_metrics enable row level security;
create policy agent_metrics_rw on agent_metrics
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
