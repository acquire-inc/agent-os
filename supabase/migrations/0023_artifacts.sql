-- Migration 0023: agent run artifacts.
--
-- Phase 47. The operator described "an output type of interface where all
-- the artifacts the agents produce appear there. Whether that's
-- spreadsheets or other things of that sort." This table is the source
-- of truth for that surface.
--
-- An artifact is anything a run produced that the operator wants to see:
-- a file path (s3://, file://, https://), an inline JSON payload, a
-- markdown doc, a link to an external resource. The `kind` column is the
-- front-end's renderer hint.
--
-- The runner writes artifacts at run close — the existing run_summaries
-- table carries evidence_paths[] which we will continue to populate for
-- backwards compat; the new artifacts table is the richer surface.

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('file', 'doc', 'spreadsheet', 'image', 'link', 'json', 'markdown', 'code')),
  name TEXT NOT NULL,
  uri TEXT,
  inline_payload JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (uri IS NOT NULL OR inline_payload IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS artifacts_run_idx ON artifacts (run_id, created_at);
CREATE INDEX IF NOT EXISTS artifacts_agent_idx ON artifacts (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_tenant_kind_idx ON artifacts (tenant_id, kind, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'is_tenant_member' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'is_tenant_member() function missing — apply migration 0008 first';
  END IF;
END$$;

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON artifacts
  FOR ALL
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

COMMENT ON TABLE artifacts IS
  'Phase 47: per-run outputs surfaced to the operator dashboard. The chat workspace renders these as the "output type of interface" the operator described. kind is the renderer hint; uri OR inline_payload must be set.';
