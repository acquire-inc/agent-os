-- Migration 0032: lead pipeline (P3 Discovery + P4 Enrichment + Scoring).
--
-- Four tenant-scoped tables that together host the discovery → enrichment →
-- scoring loop. Discovery Agent inserts to `leads` (status=new) + writes one
-- event per lead; Enrichment+Scoring Agent reads `status=new` in batches,
-- mutates `leads.enrichment` + `leads.icp_score` + `leads.qualified` + writes
-- `enriched` / `scored` events.
--
--   1. icps              — per-tenant ICP rows; one is active at a time
--   2. leads             — the unit of work flowing through the pipeline
--   3. lead_events       — ordered audit log (discovered, enriched, scored, …)
--   4. suppression_list  — DNC / opt-out / known-bad domains-emails-phones
--
-- Multi-tenant invariant: every table carries tenant_id + RLS scoped to
-- tenant_members.user_id = auth.uid(). Cross-tenant reads MUST return zero
-- rows; verified by the live isolation suite (hard gate #2).

-- ── icps ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS icps (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  active                   BOOLEAN NOT NULL DEFAULT false,
  -- Discovery taxonomy. The actor-selection matrix keys off this.
  target_type              TEXT NOT NULL CHECK (target_type IN ('local_smb', 'mid_market', 'tech_funded', 'enterprise', 'creator')),
  -- Positive signals for the scorer. Free-form jsonb so the operator can tune
  -- without a migration. Shape e.g. {"hiring": 10, "ad_spend_growth": 15, ...}.
  positive_signals         JSONB NOT NULL DEFAULT '{}',
  min_revenue_usd          BIGINT,
  min_headcount            INTEGER,
  max_headcount            INTEGER,
  titles                   JSONB NOT NULL DEFAULT '[]',       -- TEXT[] in JSONB form
  verticals                JSONB NOT NULL DEFAULT '[]',
  geo                      JSONB NOT NULL DEFAULT '[]',       -- city/state/region strings
  countries                JSONB NOT NULL DEFAULT '[]',
  -- Operational caps. Both are hard floors enforced by the agents.
  daily_discovery_limit    INTEGER NOT NULL DEFAULT 200 CHECK (daily_discovery_limit > 0),
  enrichment_batch_size    INTEGER NOT NULL DEFAULT 25 CHECK (enrichment_batch_size > 0),
  -- icp_score >= score_threshold => qualified=true (unless DNC/invalid email).
  score_threshold          INTEGER NOT NULL DEFAULT 60 CHECK (score_threshold BETWEEN 0 AND 100),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS icps_tenant_active_idx ON icps (tenant_id, active)
  WHERE active = true;
-- Only one ACTIVE icp per tenant (the agents read "the" active ICP).
CREATE UNIQUE INDEX IF NOT EXISTS icps_one_active_per_tenant
  ON icps (tenant_id) WHERE active = true;

COMMENT ON TABLE icps IS
  'P3/P4: per-tenant Ideal Customer Profiles. One active at a time. Agents read the active row at the start of every cycle.';

-- ── leads ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  icp_id              UUID REFERENCES icps(id) ON DELETE SET NULL,
  -- Dedupe key — typically `${normalized_domain}:${normalized_email}` or
  -- `${normalized_domain}:${linkedin_url}`. Computed by the agent at insert
  -- time. UNIQUE per tenant so cross-tenant collisions stay isolated.
  dedupe_key          TEXT NOT NULL,
  -- Lifecycle: new (just discovered) → enriching → qualified / disqualified
  -- → in_outreach → replied / bounced. Outreach states added by later phases.
  status              TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'enriching', 'qualified', 'disqualified', 'in_outreach', 'replied', 'bounced', 'closed')),
  -- Provenance.
  source_actor        TEXT NOT NULL,    -- 'apify:apollo-scraper', 'apollo:search', etc.
  source_query        JSONB,            -- the query the actor was given (audit + replay)
  raw                 JSONB NOT NULL DEFAULT '{}',  -- whatever the source returned
  -- Normalized fields (denormalized for query speed; raw is the source of truth).
  first_name          TEXT,
  last_name           TEXT,
  email               TEXT,
  email_status        TEXT CHECK (email_status IN ('unknown', 'valid', 'risky', 'invalid', 'catchall', 'role')),
  phone               TEXT,
  phone_type          TEXT CHECK (phone_type IN ('unknown', 'mobile', 'landline', 'voip', 'invalid')),
  dnc_flag            BOOLEAN NOT NULL DEFAULT false,
  title               TEXT,
  company             TEXT,
  domain              TEXT,
  linkedin_url        TEXT,
  -- Enrichment + scoring outputs.
  enrichment          JSONB NOT NULL DEFAULT '{}',  -- {firmographics, signals, messaging_angle, contact, personalization}
  icp_score           INTEGER CHECK (icp_score BETWEEN 0 AND 100),
  qualified           BOOLEAN,
  -- Timestamps.
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  enriched_at         TIMESTAMPTZ,
  scored_at           TIMESTAMPTZ,
  CONSTRAINT leads_dedupe_unique_per_tenant UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS leads_tenant_status_idx ON leads (tenant_id, status);
CREATE INDEX IF NOT EXISTS leads_tenant_icp_status_idx ON leads (tenant_id, icp_id, status);
CREATE INDEX IF NOT EXISTS leads_tenant_qualified_idx ON leads (tenant_id, qualified)
  WHERE qualified = true;
CREATE INDEX IF NOT EXISTS leads_tenant_new_created_idx ON leads (tenant_id, created_at DESC)
  WHERE status = 'new';

COMMENT ON TABLE leads IS
  'P3/P4: the unit of work flowing through discovery → enrichment → scoring. Dedupe by (tenant_id, dedupe_key). Raw is source of truth; normalized fields are denormalized for speed.';

-- ── lead_events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
    'discovered', 'enriched', 'scored', 'suppressed',
    'outreach_sent', 'opened', 'clicked', 'replied', 'bounced', 'closed'
  )),
  payload       JSONB NOT NULL DEFAULT '{}',
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_events_tenant_lead_idx ON lead_events (tenant_id, lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS lead_events_tenant_type_idx ON lead_events (tenant_id, type, occurred_at DESC);

COMMENT ON TABLE lead_events IS
  'P3/P4: ordered audit log per lead. Append-only; no UPDATE/DELETE expected.';

-- ── suppression_list ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppression_list (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('email', 'domain', 'phone', 'linkedin_url')),
  value       TEXT NOT NULL,            -- normalized: lowercase email, e164 phone, etc.
  reason      TEXT,                     -- 'unsubscribed', 'bounced_hard', 'manual', 'competitor', …
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT suppression_unique UNIQUE (tenant_id, kind, value)
);

CREATE INDEX IF NOT EXISTS suppression_lookup_idx ON suppression_list (tenant_id, kind, value);

COMMENT ON TABLE suppression_list IS
  'P3: DNC / opt-out / never-contact list. Discovery skips anything matching; enrichment sets dnc_flag.';

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Mirror the policy shape used by objectives/critic_votes/agent_leases: tenant
-- visible iff the requesting user is a tenant_member of that tenant.
-- service_role bypasses RLS by default (used by the API on behalf of agents).

ALTER TABLE icps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS icps_select_own_tenant ON icps;
CREATE POLICY icps_select_own_tenant ON icps FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS icps_modify_own_tenant ON icps;
CREATE POLICY icps_modify_own_tenant ON icps FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_select_own_tenant ON leads;
CREATE POLICY leads_select_own_tenant ON leads FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS leads_modify_own_tenant ON leads;
CREATE POLICY leads_modify_own_tenant ON leads FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_events_select_own_tenant ON lead_events;
CREATE POLICY lead_events_select_own_tenant ON lead_events FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS lead_events_modify_own_tenant ON lead_events;
CREATE POLICY lead_events_modify_own_tenant ON lead_events FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppression_select_own_tenant ON suppression_list;
CREATE POLICY suppression_select_own_tenant ON suppression_list FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS suppression_modify_own_tenant ON suppression_list;
CREATE POLICY suppression_modify_own_tenant ON suppression_list FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
