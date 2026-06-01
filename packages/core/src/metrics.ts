// Phase 8 — agent metrics aggregation + autonomy recommendation.
// Rolls up runs / approvals / autonomy_events into a daily per-agent scorecard
// (agent_metrics), and turns that scorecard into a promote/demote/hold recommendation.
// Pure aggregation + a pure decision function so agent-evaluator (and tests) can use both.
import { schema, type Db } from "@agent-os/db";
import { and, eq } from "drizzle-orm";

export interface AgentMetricsResult {
  agentId: string;
  date: string; // YYYY-MM-DD (UTC)
  runs: number;
  successes: number;
  failures: number;
  successRate: number;
  approvalsRequested: number;
  approvalsGranted: number;
  approvalRate: number;
  interventions: number;
  costUsd: number;
  avgLatencyMs: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Aggregate a single agent's runs/approvals/autonomy events into a scorecard and upsert
 *  it into agent_metrics keyed by (agent_id, date). Returns the computed result. */
export async function computeAgentMetrics(
  db: Db,
  agentId: string,
  opts: { tenantId?: string; date?: Date } = {},
): Promise<AgentMetricsResult> {
  const date = ymd(opts.date ?? new Date());

  const runRows = await db.select().from(schema.runs).where(eq(schema.runs.agentId, agentId));
  const approvalRows = await db.select().from(schema.approvals).where(eq(schema.approvals.agentId, agentId));
  const eventRows = await db.select().from(schema.autonomyEvents).where(eq(schema.autonomyEvents.agentId, agentId));

  const terminal = runRows.filter((r) => r.status === "done" || r.status === "failed");
  const successes = terminal.filter((r) => r.status === "done").length;
  const failures = terminal.filter((r) => r.status === "failed").length;
  const successRate = terminal.length ? successes / terminal.length : 0;

  const approvalsRequested = approvalRows.length;
  const approvalsGranted = approvalRows.filter((a) => a.status === "approved").length;
  const decided = approvalRows.filter((a) => a.status === "approved" || a.status === "rejected").length;
  const approvalRate = decided ? approvalsGranted / decided : 0;

  const interventions = eventRows.filter((e) => e.kind === "propose" || e.kind === "deny").length;
  const costUsd = runRows.reduce((s, r) => s + Number(r.costUsd ?? 0), 0);

  const latencies = runRows
    .filter((r) => r.startedAt && r.endedAt)
    .map((r) => new Date(r.endedAt as unknown as string).getTime() - new Date(r.startedAt as unknown as string).getTime())
    .filter((ms) => ms >= 0);
  const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  const result: AgentMetricsResult = {
    agentId, date,
    runs: runRows.length, successes, failures, successRate,
    approvalsRequested, approvalsGranted, approvalRate,
    interventions, costUsd, avgLatencyMs,
  };

  // Resolve tenant for the row (RLS-scoped).
  let tenantId = opts.tenantId;
  if (!tenantId) {
    const [agent] = await db.select({ tenantId: schema.agents.tenantId }).from(schema.agents).where(eq(schema.agents.id, agentId));
    tenantId = agent?.tenantId;
  }
  if (!tenantId) throw new Error(`computeAgentMetrics: no tenant for agent ${agentId}`);

  const row = {
    tenantId, agentId, date,
    runs: result.runs, successes, failures,
    successRate: successRate.toFixed(4),
    approvalsRequested, approvalsGranted,
    approvalRate: approvalRate.toFixed(4),
    interventions,
    costUsd: costUsd.toFixed(4),
    avgLatencyMs,
    computedAt: new Date(),
  };
  await db.insert(schema.agentMetrics).values(row).onConflictDoUpdate({
    target: [schema.agentMetrics.agentId, schema.agentMetrics.date],
    set: row,
  });

  return result;
}

export type AutonomyAction = "promote" | "demote" | "hold";
export interface AutonomyRecommendation {
  action: AutonomyAction;
  reason: string;
}

const AUTONOMY_RANK: Record<string, number> = { propose: 0, execute_safe: 1, execute_full: 2 };

/**
 * Turn a scorecard into a promote/demote/hold recommendation. Pure.
 * Doctrine (CLAUDE.md): promotion is EARNED from eval/approval-rate metrics; demotion is
 * AUTOMATIC on drops. Demotion checks first (safety), then promotion gates on volume + rates.
 *
 * Can't-fail ceiling (the compensating control for the all-Hermes operator override): pass the
 * agent's `currentAutonomy` + `maxAutonomy` (from `maxAutonomyForAgent`). A can't-fail agent is
 * capped at `propose`, so a strong scorecard yields `hold`, NOT `promote` — every irreversible
 * action keeps hitting the human Approvals gate no matter how good the metrics look. Demotion is
 * never blocked by the ceiling (safety always wins).
 */
export function proposeAutonomyChange(
  m: Pick<AgentMetricsResult, "runs" | "successRate" | "approvalRate">,
  opts: {
    minRuns?: number;
    demoteSuccessRate?: number;
    promoteSuccessRate?: number;
    promoteApprovalRate?: number;
    currentAutonomy?: string;
    maxAutonomy?: string;
  } = {},
): AutonomyRecommendation {
  const minRuns = opts.minRuns ?? 10;
  const demoteSuccess = opts.demoteSuccessRate ?? 0.8;
  const promoteSuccess = opts.promoteSuccessRate ?? 0.95;
  const promoteApproval = opts.promoteApprovalRate ?? 0.9;

  // Demotion is automatic on a real success-rate drop, regardless of volume OR ceiling.
  if (m.runs >= minRuns && m.successRate < demoteSuccess) {
    return { action: "demote", reason: `success_rate ${(m.successRate * 100).toFixed(0)}% < ${(demoteSuccess * 100).toFixed(0)}% over ${m.runs} runs` };
  }
  if (m.runs < minRuns) {
    return { action: "hold", reason: `insufficient volume (${m.runs} < ${minRuns} runs)` };
  }
  if (m.successRate >= promoteSuccess && m.approvalRate >= promoteApproval) {
    // Auto-promotion ceiling: a can't-fail agent (maxAutonomy=propose) — or any agent already at
    // its max — can't earn its way past the human gate. Metrics this good → hold, not promote.
    if (opts.currentAutonomy != null && opts.maxAutonomy != null) {
      const cur = AUTONOMY_RANK[opts.currentAutonomy] ?? 0;
      const max = AUTONOMY_RANK[opts.maxAutonomy] ?? 2;
      if (cur >= max) {
        return { action: "hold", reason: `at autonomy ceiling (${opts.maxAutonomy}) — promotion gated to human; success ${(m.successRate * 100).toFixed(0)}%` };
      }
    }
    return { action: "promote", reason: `success ${(m.successRate * 100).toFixed(0)}% & approval ${(m.approvalRate * 100).toFixed(0)}% over ${m.runs} runs` };
  }
  return { action: "hold", reason: `steady (success ${(m.successRate * 100).toFixed(0)}%, approval ${(m.approvalRate * 100).toFixed(0)}%)` };
}
