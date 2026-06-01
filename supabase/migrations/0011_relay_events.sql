-- 0011_relay_events.sql
-- Phase 10 (Relay P0): the unified event bus row. Every meaningful state
-- change in the OS lands here exactly once, replacing the divergent shapes
-- of runs, run_activity, autonomy_events, and audit_log over a 4-step
-- coexist→mirror→read-cutover→write-cutover migration (see AGENT-OS-PLAN §8.6).
--
-- Schema per docs/plans/AGENT-OS-PLAN.md §8.2 (the canonical contract).
-- AGENTS-PLAN.md §2 defines what every agent emits into this; GENX-PLAN.md
-- §4 layers the external Pixel SDK on top of the SAME table via /relay/ingest.
--
-- Privacy posture is schema-enforced (consent_scope + pii_class check
-- constraints + the relay_events_xtenant_agg view as the only cross-tenant
-- egress path). Per AGENT-OS-PLAN §8.5.
--
-- The canonical event-name namespace lives in code
-- (packages/core/src/relay/events.ts EVENT_NAMES const). The DB does NOT
-- enforce the closed set — keeping it in code means migrations don't need
-- to land for every new event, and the runtime emit() helper rejects
-- unknown names before insert. Rationale: schema-vs-code tradeoff; the
-- closed set evolves frequently, and `event-schema-guardian` (v2 D3.1)
-- audits drift between the registry and what's landed.

create table if not exists relay_events (
  id              uuid primary key default gen_random_uuid(),

  -- Tenancy (NOT NULL, RLS-enforced)
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- Provenance / subject. Null run_id allowed for system-level events
  -- (e.g. lifecycle.changed on an agent outside any run).
  agent_id        uuid references agents(id) on delete set null,
  run_id          uuid references runs(id) on delete cascade,
  actor           text not null check (actor in ('agent','system','human','external')),
  actor_id        text,                          -- internal: uuid; external (GenX SDK): opaque

  -- The event itself
  event_name      text not null,                 -- canonical dotted namespace (code-enforced via emit())
  payload         jsonb not null default '{}'::jsonb,

  -- Causal chain — handoff chains reconstruct via these.
  -- correlation_id ties a multi-step workflow (root = the originating run.id today;
  -- a `workflows` table is parked per Open Q #14 in AGENT-OS-PLAN.md).
  -- causation_id is the relay_events.id that directly caused this event.
  correlation_id  uuid,
  causation_id    uuid,

  -- Idempotency. External (Pixel SDK) callers stamp event_key for replay safety;
  -- internal emitters MAY supply it too. Unique with tenant_id.
  event_key       text,

  -- Privacy posture (§8.5 — schema-enforced contract)
  consent_scope   text not null default 'tenant_only'
                    check (consent_scope in ('tenant_only','cross_tenant_aggregated')),
  pii_class       text not null default 'none'
                    check (pii_class in ('none','internal_id','client_pii')),

  -- Time. occurred_at is when the event happened in the world; ingested_at is
  -- when we wrote it. They differ for batched / replayed external Pixel events.
  occurred_at     timestamptz not null,
  ingested_at     timestamptz not null default now()
);

create index if not exists relay_events_tenant_time_idx on relay_events(tenant_id, occurred_at desc);
create index if not exists relay_events_run_idx on relay_events(run_id) where run_id is not null;
create index if not exists relay_events_agent_idx on relay_events(agent_id) where agent_id is not null;
create index if not exists relay_events_name_idx on relay_events(event_name);
create index if not exists relay_events_correlation_idx on relay_events(correlation_id) where correlation_id is not null;
create unique index if not exists relay_events_idempotency_idx on relay_events(tenant_id, event_key) where event_key is not null;

-- RLS — same is_tenant_member() pattern as the rest of the schema.
alter table relay_events enable row level security;
drop policy if exists relay_events_rw on relay_events;
create policy relay_events_rw on relay_events
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- ------------------------------------------------------------------------
-- Cross-tenant aggregation view — the ONLY path out of the per-tenant RLS box.
-- Filters consent + aggregates. No raw row egress across tenants.
-- ------------------------------------------------------------------------
-- The view itself is RLS-respecting (it queries the underlying table which
-- has RLS enabled), but access is gated by service-role + a Hono route
-- guarded by an internal "platform_admin" role (TBD per AGENT-OS-PLAN Open
-- Q #11). The consent_scope filter is the consent boundary; the date_trunc
-- + count aggregations are the pattern-level boundary (no row egress).
drop view if exists relay_events_xtenant_agg;
create view relay_events_xtenant_agg as
  select
    date_trunc('hour', occurred_at) as bucket,
    event_name,
    count(*) as event_count,
    count(distinct tenant_id) as tenant_count,
    count(distinct agent_id) as agent_count
  from relay_events
  where consent_scope = 'cross_tenant_aggregated'
  group by date_trunc('hour', occurred_at), event_name;

-- ------------------------------------------------------------------------
-- Rollback (operator-only — destructive):
--   drop view if exists relay_events_xtenant_agg;
--   drop table if exists relay_events;
-- ------------------------------------------------------------------------
