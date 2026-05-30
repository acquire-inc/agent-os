-- Tool registry + agent→tool bindings. Closes the build-spec §3 TOOL REGISTRY
-- (lines 106-108) and agent_tool_bindings (line 101), which were specified but
-- never created. The doctrine's agent prompts reference deterministic tools
-- (`tool.1`..`tool.22` + named tools like `tool.proof-vault`); until those are
-- real rows the Runner can't resolve what an agent may call. This makes the
-- "tools are the only per-agent code" rule concrete: a tool is a registry row;
-- an agent's tool list is data (a join), exactly like skills and MCPs.
--
-- Per the one rule (agents are data), nothing here is per-agent — `tools` is a
-- shared catalog and `agent_tools` is the binding, mirroring agent_skills/agent_mcps.

create table tools (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  tool_key          text not null,                                   -- e.g. 'tool.1', 'tool.proof-vault'
  name              text not null,
  description       text not null default '',
  kind              text not null default 'custom' check (kind in ('custom','mcp')),
  requires_approval boolean not null default false,                  -- gated in safety hooks at call time
  reversible        boolean not null default true,                   -- false = side-effecting/external action
  status            text not null default 'planned' check (status in ('planned','active','deprecated')),
  created_at        timestamptz not null default now(),
  unique (tenant_id, tool_key)
);
create index tools_tenant_idx on tools(tenant_id);

-- Which tools an agent may call. Mirrors agent_skills/agent_mcps (no tenant_id;
-- tenancy enforced through the agent in the RLS policy).
create table agent_tools (
  agent_id uuid not null references agents(id) on delete cascade,
  tool_id  uuid not null references tools(id) on delete cascade,
  primary key (agent_id, tool_id)
);

alter table tools enable row level security;
create policy tools_rw on tools
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

alter table agent_tools enable row level security;
create policy agent_tools_rw on agent_tools
  using (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)))
  with check (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)));
