-- Agent OS — initial schema (Master Build Document, Part V)
-- Postgres 16 + pgvector. Designed for Supabase: tenant isolation via RLS keyed
-- off tenant_members + auth.uid().

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";      -- pgvector embeddings

-- ----------------------------------------------------------------------------
-- auth shim
-- On Supabase, auth.users and auth.uid() already exist. For local/non-Supabase
-- Postgres we create lightweight stand-ins so migrations + RLS apply cleanly.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
  ) then
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique
    );
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    -- Reads a GUC the app/tests may set; null when unauthenticated.
    create function auth.uid() returns uuid
      language sql stable
      as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Identity & tenancy
-- ----------------------------------------------------------------------------
create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table tenants (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text not null unique,
  type               text not null default 'internal' check (type in ('internal','client')),
  status             text not null default 'active' check (status in ('active','suspended')),
  monthly_budget_usd numeric(12,2),
  created_at         timestamptz not null default now()
);

create table tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on tenant_members(user_id);

-- Membership helper used by every RLS policy.
create or replace function is_tenant_member(t uuid)
  returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (
    select 1 from tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid()
  ) $$;

-- ----------------------------------------------------------------------------
-- Projects, tags
-- ----------------------------------------------------------------------------
create table projects (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  description text
);
create index projects_tenant_idx on projects(tenant_id);

create table tags (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name      text not null,
  unique (tenant_id, name)
);

create table entity_tags (
  entity_type text not null,
  entity_id   uuid not null,
  tag_id      uuid not null references tags(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  primary key (entity_type, entity_id, tag_id)
);
create index entity_tags_lookup_idx on entity_tags(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- Agents
-- ----------------------------------------------------------------------------
create table agents (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  key                 text not null,
  name                text not null,
  persona             text,
  backend             text not null default 'claude-agent-sdk'
                        check (backend in ('claude-agent-sdk','codex','gemini')),
  model               text not null default 'claude-sonnet-4-6',
  thinking_level      text not null default 'medium'
                        check (thinking_level in ('none','low','medium','high')),
  autonomy            text not null default 'propose'
                        check (autonomy in ('propose','execute_safe','execute_full')),
  knowledge_scope_json jsonb not null default '{"folders":[],"tags":[]}'::jsonb,
  budget_cap_usd      numeric(12,2),
  escalation_policy   text,
  runner_kind         text not null default 'local' check (runner_kind in ('local','remote')),
  enabled             boolean not null default true,
  template_id         uuid,
  created_at          timestamptz not null default now(),
  unique (tenant_id, key)
);
create index agents_tenant_idx on agents(tenant_id);

create table project_entities (
  project_id  uuid not null references projects(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  primary key (project_id, entity_type, entity_id)
);

create table agent_skills (
  agent_id  uuid not null references agents(id) on delete cascade,
  skill_id  uuid not null,
  primary key (agent_id, skill_id)
);

create table agent_mcps (
  agent_id uuid not null references agents(id) on delete cascade,
  mcp_id   uuid not null,
  primary key (agent_id, mcp_id)
);

-- ----------------------------------------------------------------------------
-- Jobs & Runs
-- ----------------------------------------------------------------------------
create table jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  agent_id          uuid not null references agents(id) on delete cascade,
  name              text not null,
  schedule_cron     text not null,
  instructions      text not null default '',
  model_override    text,
  thinking_override text check (thinking_override in ('none','low','medium','high')),
  enabled           boolean not null default true,
  created_at        timestamptz not null default now()
);
create index jobs_tenant_idx on jobs(tenant_id);
create index jobs_agent_idx on jobs(agent_id);

create table job_refs (
  job_id   uuid not null references jobs(id) on delete cascade,
  ref_type text not null check (ref_type in ('doc','skill','mcp','database','envvar')),
  ref_id   uuid not null,
  primary key (job_id, ref_type, ref_id)
);

create table runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  agent_id       uuid not null references agents(id) on delete cascade,
  job_id         uuid references jobs(id) on delete set null,
  status         text not null default 'scheduled'
                  check (status in ('scheduled','running','done','failed','skipped','waiting','pending')),
  trigger_source text not null default 'schedule'
                  check (trigger_source in ('schedule','manual','routine','api')),
  scheduled_for  timestamptz,
  claimed_by     text,
  started_at     timestamptz,
  ended_at       timestamptz,
  tokens_in      bigint not null default 0,
  tokens_out     bigint not null default 0,
  cost_usd       numeric(12,4) not null default 0,
  summary        text,
  sdk_session_id text,
  created_at     timestamptz not null default now()
);
create index runs_tenant_idx on runs(tenant_id);
create index runs_agent_idx on runs(agent_id);
create index runs_status_idx on runs(status);
-- Supports the transactional claim (Master doc §2.2).
create index runs_claim_idx on runs(agent_id, status, scheduled_for);

create table run_activity (
  id      uuid primary key default gen_random_uuid(),
  run_id  uuid not null references runs(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  ts      timestamptz not null default now(),
  kind    text not null,
  message text not null
);
create index run_activity_run_idx on run_activity(run_id);

-- ----------------------------------------------------------------------------
-- Routines
-- ----------------------------------------------------------------------------
create table routines (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  name       text not null,
  cadence    text not null check (cadence in ('daily','weekly','monthly','cron')),
  job_ids    uuid[] not null default '{}',
  enabled    boolean not null default true
);
create index routines_tenant_idx on routines(tenant_id);

-- ----------------------------------------------------------------------------
-- Skill Registry
-- ----------------------------------------------------------------------------
create table skills (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid references projects(id) on delete set null,
  key         text not null,
  name        text not null,
  description text not null default '',
  version     text not null default '0.1.0',
  source      text not null default 'custom' check (source in ('github','builtin','custom')),
  repo_path   text,
  scope       text not null default 'global' check (scope in ('global','project')),
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, key)
);
create index skills_tenant_idx on skills(tenant_id);

-- ----------------------------------------------------------------------------
-- MCP Registry + OAuth Vault
-- ----------------------------------------------------------------------------
create table mcps (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  project_id        uuid references projects(id) on delete set null,
  name              text not null,
  transport         text not null default 'http' check (transport in ('stdio','http')),
  endpoint          text,
  auth_type         text not null default 'none' check (auth_type in ('none','api_key','oauth')),
  scope             text not null default 'global' check (scope in ('global','project')),
  status            text not null default 'disconnected'
                     check (status in ('connected','needs_reauth','disconnected','error')),
  last_health_check timestamptz,
  created_at        timestamptz not null default now()
);
create index mcps_tenant_idx on mcps(tenant_id);

create table oauth_credentials (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  mcp_id     uuid not null references mcps(id) on delete cascade,
  vault_ref  text not null,
  scopes     text[] not null default '{}',
  expires_at timestamptz,
  status     text not null default 'connected'
              check (status in ('connected','needs_reauth','disconnected','error'))
);

create table env_vars (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  project_id      uuid references projects(id) on delete set null,
  key             text not null,
  encrypted_value text not null,
  pinned          boolean not null default false
);

-- ----------------------------------------------------------------------------
-- Knowledge Store
-- ----------------------------------------------------------------------------
create table knowledge_folders (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  parent_id  uuid references knowledge_folders(id) on delete cascade,
  name       text not null,
  path       text not null
);
create index knowledge_folders_tenant_idx on knowledge_folders(tenant_id);

create table documents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  project_id       uuid references projects(id) on delete set null,
  folder_id        uuid references knowledge_folders(id) on delete set null,
  name             text not null,
  type             text not null default 'markdown',
  source           text not null default 'upload'
                    check (source in ('upload','drive-sync','agent-generated','call-transcript')),
  vector_namespace text,
  vector_indexed   boolean not null default false,
  version          integer not null default 1,
  updated_at       timestamptz not null default now()
);
create index documents_tenant_idx on documents(tenant_id);

create table doc_chunks (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references documents(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  vector_namespace text,
  content          text not null,
  embedding        vector(1536)
);
create index doc_chunks_document_idx on doc_chunks(document_id);

create table databases (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid references projects(id) on delete set null,
  name        text not null,
  schema_json jsonb not null default '{}'::jsonb
);

create table database_rows (
  id          uuid primary key default gen_random_uuid(),
  database_id uuid not null references databases(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  row_json    jsonb not null default '{}'::jsonb
);

-- ----------------------------------------------------------------------------
-- Approvals & audit
-- ----------------------------------------------------------------------------
create table approvals (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references runs(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  agent_id        uuid not null references agents(id) on delete cascade,
  context         text not null,
  proposed_action text not null,
  options_json    jsonb not null default '[]'::jsonb,
  status          text not null default 'open' check (status in ('open','decided','expired')),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index approvals_tenant_idx on approvals(tenant_id);
create index approvals_status_idx on approvals(status);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  run_id     uuid references runs(id) on delete set null,
  tool_name  text not null,
  input_hash text,
  result     text,
  ts         timestamptz not null default now()
);
create index audit_log_tenant_idx on audit_log(tenant_id);

-- ----------------------------------------------------------------------------
-- API keys
-- ----------------------------------------------------------------------------
create table api_keys (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  kind       text not null check (kind in ('runner','external','admin')),
  name       text not null,
  hash       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index api_keys_tenant_idx on api_keys(tenant_id);

-- ----------------------------------------------------------------------------
-- Transactional run claim (Master doc §2.2) — the runs table is the queue.
-- ----------------------------------------------------------------------------
create or replace function claim_next_run(p_agent uuid, p_tenant uuid, p_runner text)
  returns runs
  language sql
  as $$
    update runs set status = 'running', claimed_by = p_runner, started_at = now()
    where id = (
      select id from runs
      where agent_id = p_agent and tenant_id = p_tenant and status = 'scheduled'
      order by scheduled_for asc nulls last
      for update skip locked
      limit 1
    )
    returning *;
  $$;

-- ----------------------------------------------------------------------------
-- Row-Level Security — tenant isolation on every tenant-scoped table.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  -- Tables carrying tenant_id directly. Join tables without tenant_id
  -- (job_refs, agent_skills, agent_mcps) get explicit policies below.
  tenant_tables text[] := array[
    'tenants','projects','tags','entity_tags','agents','project_entities',
    'jobs','runs','run_activity','routines','skills','mcps',
    'oauth_credentials','env_vars','knowledge_folders','documents','doc_chunks',
    'databases','database_rows','approvals','audit_log','api_keys'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security;', t);
    if t = 'tenants' then
      execute format($p$
        create policy tenant_rw on %I
          using (is_tenant_member(id))
          with check (is_tenant_member(id));
      $p$, t);
    else
      execute format($p$
        create policy tenant_rw on %I
          using (is_tenant_member(tenant_id))
          with check (is_tenant_member(tenant_id));
      $p$, t);
    end if;
  end loop;
end $$;

-- Join tables without their own tenant_id — authorize via the parent row.
alter table job_refs enable row level security;
create policy job_refs_rw on job_refs
  using (exists (select 1 from jobs j where j.id = job_id and is_tenant_member(j.tenant_id)))
  with check (exists (select 1 from jobs j where j.id = job_id and is_tenant_member(j.tenant_id)));

alter table agent_skills enable row level security;
create policy agent_skills_rw on agent_skills
  using (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)))
  with check (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)));

alter table agent_mcps enable row level security;
create policy agent_mcps_rw on agent_mcps
  using (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)))
  with check (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)));

-- profiles + tenant_members: a user sees their own membership rows.
alter table profiles enable row level security;
create policy profiles_self on profiles
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table tenant_members enable row level security;
create policy tenant_members_self on tenant_members
  using (user_id = auth.uid() or is_tenant_member(tenant_id));
