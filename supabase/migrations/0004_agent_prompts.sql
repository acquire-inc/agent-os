-- Versioned per-agent system prompt. Closes GAP P from A2:
-- the doctrine treats `system_prompt` as a versioned row, not inline persona.
-- Storing prompts as rows lets prompt change be a config-level operation, lets
-- us roll back without code archaeology, and is the data-form the doctrine
-- assumes when the build-spec says "agents are data."
--
-- agents.persona is kept as a denormalized cache of the current prompt so the
-- existing buildSystemPrompt path in the runner needs no change. The current
-- prompt for an agent is the row with is_current = true (exactly one).

create table agent_prompts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  agent_id      uuid not null references agents(id) on delete cascade,
  version       integer not null default 1,
  system_prompt text not null,
  is_current    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (agent_id, version)
);
create index agent_prompts_agent_idx on agent_prompts(agent_id);
-- Enforce exactly one current prompt per agent.
create unique index agent_prompts_one_current_idx
  on agent_prompts(agent_id) where is_current = true;

alter table agent_prompts enable row level security;
create policy tenant_rw on agent_prompts
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
