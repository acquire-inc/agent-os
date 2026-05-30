-- 0007_tools_registry.sql
-- Tools registry — first-class `tools` table + `agent_tools` join, mirroring the
-- skills/agent_skills and mcps/agent_mcps lift (see 0001_init.sql).
-- Tools are DATA, not code (CLAUDE.md): a registry row + RLS, bound to agents the
-- same way skills/MCPs already are. Phase 7 build delta (main doctrine §6).
--
-- Rollback (see 07-01-PLAN.md <rollback>): precondition agent_tools has zero rows, then
--   drop table if exists agent_tools cascade;
--   drop table if exists tools cascade;
-- (cascade also drops the RLS policies tools_rw / agent_tools_rw and tools_tenant_idx.)

-- ----------------------------------------------------------------------------
-- Tools registry — top-level, tenant-scoped (architect_blueprints pattern).
-- ----------------------------------------------------------------------------
create table tools (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  key               text not null,
  name              text not null,
  description       text not null default '',
  kind              text not null check (kind in ('custom','mcp')),
  mcp_id            uuid references mcps(id) on delete set null,
  input_schema      jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default true,
  reversible        boolean not null default false,
  status            text not null default 'active'
                     check (status in ('active','disabled','deprecated')),
  created_at        timestamptz not null default now(),
  unique (tenant_id, key)
);
create index tools_tenant_idx on tools(tenant_id);

-- ----------------------------------------------------------------------------
-- agent_tools join — no own tenant_id; authorized via parent agent (agent_mcps pattern).
-- ----------------------------------------------------------------------------
create table agent_tools (
  agent_id uuid not null references agents(id) on delete cascade,
  tool_id  uuid not null references tools(id) on delete cascade,
  primary key (agent_id, tool_id)
);

-- ----------------------------------------------------------------------------
-- Row-Level Security — tenant isolation. Cross-tenant read returns zero rows.
-- ----------------------------------------------------------------------------
alter table tools enable row level security;
create policy tools_rw on tools
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- Join table without its own tenant_id — authorize via the parent agent's tenant.
alter table agent_tools enable row level security;
create policy agent_tools_rw on agent_tools
  using (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)))
  with check (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)));
