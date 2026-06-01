-- 0010_security_findings.sql
-- Phase 9: the durable artifact every security agent writes into.
-- tenant-isolation-tester, secrets-rotation, access-auditor, and
-- security-anomaly-watchdog all `insert into security_findings (...)` so the
-- operator has a single queryable surface for security state.
--
-- Per CONTEXT D-05: ONE table, not per-agent tables — payload jsonb absorbs
-- per-category structure. Per D-08: positive-control evidence (for isolation
-- tests) lives in payload, not a separate column.
-- Pitfall 3 mitigation: audit_log gets a (tenant_id, ts desc) index so the
-- anomaly watchdog can do windowed scans without a table sweep.

create table if not exists security_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  category text not null
    check (category in ('isolation', 'rotation', 'access', 'anomaly')),
  severity text not null
    check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'suppressed')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists security_findings_tenant_status_idx
  on security_findings (tenant_id, status, severity, detected_at desc);

-- Pitfall 3 mitigation: anomaly watchdog windowed scans need a covering index.
create index if not exists audit_log_tenant_ts_idx
  on audit_log (tenant_id, ts desc);

alter table security_findings enable row level security;

-- Same idiom as every other tenant-scoped table (see 0001_init.sql).
create policy security_findings_rw on security_findings
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

create or replace function security_findings_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists security_findings_touch on security_findings;
create trigger security_findings_touch
  before update on security_findings
  for each row execute function security_findings_touch_updated_at();

-- ----------------------------------------------------------------------------
-- ROLLBACK:
--   drop trigger if exists security_findings_touch on security_findings;
--   drop function if exists security_findings_touch_updated_at();
--   drop policy if exists security_findings_rw on security_findings;
--   drop index if exists security_findings_tenant_status_idx;
--   drop index if exists audit_log_tenant_ts_idx;
--   drop table if exists security_findings;
-- (Removal is non-destructive — no other table references security_findings.)
-- ----------------------------------------------------------------------------
