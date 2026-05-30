-- Typed agent triggers. Closes GAP T from A2:
-- the existing schema only models cron via jobs.schedule_cron, but the v2
-- handoff chains fire on state-changes (e.g. dunning-manager on 'payment_failed')
-- and some agents are webhook- or on-demand-driven. Modeling triggers as typed
-- rows lets every doctrine agent be defined as data without per-agent code.
--
-- Backward compat: cron triggers are PROJECTED into the existing `jobs` table
-- by the seed scripts (not by a DB trigger — keep failures visible to the seed,
-- not silent). The scheduler/orchestrator continues to read jobs unchanged.
-- Webhook/state/on_demand triggers are read only by future executors and stay
-- inert to the current cron path.

create table agent_triggers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  agent_id    uuid not null references agents(id) on delete cascade,
  type        text not null check (type in ('cron','webhook','state','on_demand')),
  schedule    text,                                          -- cron expression for type='cron'
  event_key   text,                                          -- event identifier for webhook/state
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  -- A cron trigger needs a schedule; webhook/state need an event_key; on_demand needs neither.
  check (
    (type = 'cron'      and schedule  is not null and event_key is null) or
    (type = 'webhook'   and event_key is not null and schedule  is null) or
    (type = 'state'     and event_key is not null and schedule  is null) or
    (type = 'on_demand' and schedule  is null     and event_key is null)
  )
);
create index agent_triggers_agent_idx on agent_triggers(agent_id);
create index agent_triggers_type_idx on agent_triggers(type);

alter table agent_triggers enable row level security;
create policy tenant_rw on agent_triggers
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
