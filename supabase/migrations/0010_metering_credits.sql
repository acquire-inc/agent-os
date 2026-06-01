-- 0010_metering_credits.sql
-- The metering + credits layer (DECISION-inference-metering-hosting.md §2): turn the per-run
-- raw cost the runner already records (`runs.cost_usd`) into per-tenant BILLABLE usage and a
-- credit balance — the missing piece for Cliently tenant billing, feeding the seeded
-- billing-runner / dunning-manager. `runs` stays the system-of-record (decision doc); these
-- tables are the derived billing ledger. OpenMeter (self-hosted) is the external aggregator we
-- chose; this is the local source it ingests + the in-DB balance the safety layer can gate on.

-- Per-tenant billing config + materialized balance. One row per tenant.
create table if not exists tenant_credits (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  -- prepaid credit balance (credits, not dollars — usd_per_credit converts)
  balance_credits numeric(16, 4) not null default 0,
  -- billing knobs: resale markup over raw inference cost, and the credit→USD peg.
  markup_multiple numeric(8, 4) not null default 1.0,   -- 1.0 = at-cost (internal Acqu); >1 = resale
  usd_per_credit  numeric(12, 6) not null default 1.0,   -- 1 credit = $1.00 by default
  -- when true, runs are blocked once the balance hits zero (prepaid enforcement).
  enforce_balance boolean not null default false,
  updated_at timestamptz not null default now()
);

-- One BILLABLE usage event per completed run. Idempotent on run_id (a run bills exactly once).
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  model text not null,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  raw_cost_usd  numeric(12, 4) not null default 0,   -- inference cost (from runs.cost_usd)
  billable_usd  numeric(12, 4) not null default 0,   -- raw_cost_usd * markup_multiple
  credits       numeric(16, 4) not null default 0,   -- billable_usd / usd_per_credit
  created_at timestamptz not null default now(),
  unique (run_id)
);
create index if not exists usage_events_tenant_created_idx on usage_events (tenant_id, created_at);

-- Append-only credit ledger: topups (+credits) and usage burns (-credits). The balance in
-- tenant_credits is the running sum; the ledger is the audit trail (never updated/deleted).
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- 'topup' (+), 'usage' (-), 'adjustment' (±), 'refund' (+)
  kind text not null check (kind in ('topup', 'usage', 'adjustment', 'refund')),
  delta_credits numeric(16, 4) not null,             -- signed
  balance_after numeric(16, 4) not null,             -- balance immediately after this entry
  -- provenance: a usage entry points at its usage_event; a topup at an external payment ref.
  usage_event_id uuid references usage_events(id) on delete set null,
  reference text,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_tenant_created_idx on credit_ledger (tenant_id, created_at);
