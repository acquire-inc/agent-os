-- 0006_architect_blueprints.sql
-- Architect blueprints — proposed agent teams awaiting operator review/seed.
-- Spec: docs/specs/agent-architect.md

create table if not exists architect_blueprints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  created_by_user_id uuid,
  prompt text not null,
  team_name text not null,
  rationale text not null,
  llm_model text not null,
  llm_cost_usd numeric(12, 4) not null default 0,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'seeded', 'rejected', 'superseded')),
  warnings_json jsonb not null default '[]'::jsonb,
  agents_json jsonb not null,
  proposed_skills_json jsonb not null default '[]'::jsonb,
  proposed_mcps_json jsonb not null default '[]'::jsonb,
  seeded_agent_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists architect_blueprints_tenant_status_idx
  on architect_blueprints (tenant_id, status, created_at desc);

alter table architect_blueprints enable row level security;

-- Same shape as other tenant-scoped tables — authorize via is_tenant_member().
-- See 0001_init.sql for the function definition.
create policy architect_blueprints_rw on architect_blueprints
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- Trigger to keep updated_at fresh on any UPDATE.
create or replace function architect_blueprints_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists architect_blueprints_touch on architect_blueprints;
create trigger architect_blueprints_touch
  before update on architect_blueprints
  for each row execute function architect_blueprints_touch_updated_at();
