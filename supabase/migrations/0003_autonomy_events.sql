-- Per-decision record of the autonomy gate (PreToolUse / PostToolUse / Stop /
-- SessionEnd). Complements audit_log (which captures every tool call's
-- input/output) by recording the *decision* the gate made:
--   allow / propose / deny / escalate / stop / budget_cap / session_end
-- These are the hooks the runner will fire so safety isn't ad-hoc prose.

create table autonomy_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  run_id      uuid references runs(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  ts          timestamptz not null default now(),
  kind        text not null
                check (kind in ('allow','propose','deny','escalate','stop','budget_cap','session_end')),
  tool_name   text,
  rationale   text
);
create index autonomy_events_tenant_idx on autonomy_events(tenant_id);
create index autonomy_events_run_idx on autonomy_events(run_id);
create index autonomy_events_kind_idx on autonomy_events(kind);

alter table autonomy_events enable row level security;
create policy tenant_rw on autonomy_events
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
