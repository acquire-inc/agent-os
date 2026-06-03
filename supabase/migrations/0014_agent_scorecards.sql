-- Migration 0014: agent_scorecards table — backing store for the Phase 18
-- eval scorecard verdicts. The scheduled job (Phase 20) walks each agent,
-- computes scoreAgent() against its last N run_summaries + relay event
-- aggregates, and persists the result here. A separate trigger / job applies
-- the verdict to agents.autonomy when verdict ∈ {promote, demote, force_demote_safety}.
--
-- The autonomy mutation is NOT a database trigger — it's an application-layer
-- decision (the lifecycle module owns the autonomy ladder). This table is
-- pure observation; the controller reads it and decides.

CREATE TABLE IF NOT EXISTS agent_scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  -- The window the scorecard summarized.
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  sample_size INTEGER NOT NULL,
  -- Computed rates (NaN serializes to null).
  verification_rate NUMERIC(5,4),
  approval_rate NUMERIC(5,4),
  avg_cost_utilization NUMERIC(5,4),
  findings_rate_per_run NUMERIC(8,4),
  scope_lock_refusals_per_run NUMERIC(8,4),
  output_quality_failure_rate NUMERIC(5,4),
  cantfail_events INTEGER NOT NULL DEFAULT 0,
  -- The verdict.
  verdict TEXT NOT NULL CHECK (verdict IN ('promote','hold','demote','force_demote_safety','insufficient_data')),
  rationale TEXT NOT NULL,
  triggered_thresholds JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Applied? The scheduled controller flips this when it calls the autonomy
  -- mutation. NULL = not yet applied. UNIX timestamp = applied at.
  applied_at TIMESTAMPTZ,
  -- What autonomy the controller moved the agent to (or 'unchanged').
  applied_autonomy TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_scorecards_tenant_agent_idx
  ON agent_scorecards (tenant_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_scorecards_unapplied_idx
  ON agent_scorecards (created_at DESC)
  WHERE applied_at IS NULL;

-- RLS — tenant isolation.
ALTER TABLE agent_scorecards ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON agent_scorecards
  FOR ALL
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

-- Cross-tenant aggregate view (consent-filtered) — feeds the moat lens.
-- Reads only scorecards whose run_summaries window had
-- consent_scope='cross_tenant_aggregated' across the majority of samples.
-- For v1 the view is a straight aggregation; consent filtering tightens later.
CREATE OR REPLACE VIEW agent_scorecards_xtenant_agg AS
SELECT
  agent_key,
  verdict,
  COUNT(*) AS scorecard_count,
  AVG(verification_rate) AS avg_verification_rate,
  AVG(approval_rate) AS avg_approval_rate,
  AVG(avg_cost_utilization) AS avg_cost_utilization,
  AVG(findings_rate_per_run) AS avg_findings_rate,
  SUM(cantfail_events) AS total_cantfail_events,
  MIN(window_start) AS window_earliest,
  MAX(window_end) AS window_latest
FROM agent_scorecards
GROUP BY agent_key, verdict;

COMMENT ON TABLE agent_scorecards IS
  'Phase 18 + 20: per-agent eval scorecards. Computed by the scheduled controller; verdicts inform autonomy moves via the lifecycle module.';
COMMENT ON COLUMN agent_scorecards.applied_autonomy IS
  'The autonomy the controller moved the agent to: "propose" | "execute_safe" | "execute_full" | "unchanged". Null until applied.';
