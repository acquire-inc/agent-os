// Phase 24: scheduled scorecard job for the eval-driven autonomy ladder.
//
// Triggered every 6 hours by Inngest (or any operator-configured cron). Walks
// active agents per-tenant, builds a ScorecardJobSink via Drizzle queries,
// and calls runScorecardJob() — which scores, persists to agent_scorecards,
// decides via computeNextAutonomy, and (on changed=true) calls setAutonomy
// + emits lifecycle.changed.
//
// Idempotency: the job persists ONE scorecard per (agent, window) — if
// retried within the same window, a duplicate scorecard is inserted but
// the autonomy mutation is a no-op (current == target). The scorecard rows
// are the audit trail; idempotency at the autonomy level is what matters.
//
// Concurrency: function-level limit prevents runaway parallelism. The job
// is bounded by sample-fetch latency × N agents per tenant.
//
// Production wiring: dispatch via `pg_cron` (`SELECT cron.schedule(...)`) or
// Inngest scheduled triggers. The operator wires the cron; the function
// just consumes events.

import { createDb, schema, type Db } from "@agent-os/db";
import {
  isCantFail,
  runScorecardJob,
  setAutonomy,
  type Autonomy,
  type RunSample,
  type ScorecardJobSink,
} from "@agent-os/core";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { inngest } from "../client.js";

const { agents, runSummaries, agentScorecards, relayEvents } = schema;

/**
 * Build the sink that runScorecardJob() depends on. The sink wraps Drizzle
 * queries against the live db.
 */
function buildSink(db: Db): ScorecardJobSink {
  return {
    fetchRunSamples: async (input) => {
      // Pull recent run_summaries for this agent in the window. Aggregate
      // the per-run signals scorecard expects. We read highlights jsonb +
      // join to relay_events for cantfail / approval / scope-lock data.
      const rows = await db
        .select({
          id: runSummaries.id,
          runId: runSummaries.runId,
          status: runSummaries.status,
          costActualUsd: runSummaries.costActualUsd,
          highlights: runSummaries.highlights,
          findingCount: runSummaries.findingCount,
          approvalCount: runSummaries.approvalCount,
        })
        .from(runSummaries)
        .where(
          and(
            eq(runSummaries.tenantId, input.tenantId),
            eq(runSummaries.agentId, input.agentId),
            gte(runSummaries.endedAt, input.windowStart),
          ),
        )
        .orderBy(desc(runSummaries.endedAt))
        .limit(100);

      // For each run, count cantfail.* events in relay_events.
      const runIds = rows.map((r) => r.runId);
      const cantfailCounts = new Map<string, number>();
      if (runIds.length > 0) {
        const cfRows = await db
          .select({
            runId: relayEvents.runId,
            cnt: count().as("cnt"),
          })
          .from(relayEvents)
          .where(
            and(
              eq(relayEvents.tenantId, input.tenantId),
              sql`${relayEvents.eventName} LIKE 'cantfail.%'`,
              sql`${relayEvents.runId} = ANY(${sql.raw(`ARRAY[${runIds.map((id) => `'${id}'::uuid`).join(",")}]`)})`,
            ),
          )
          .groupBy(relayEvents.runId);
        for (const cf of cfRows) {
          if (cf.runId) cantfailCounts.set(cf.runId, Number(cf.cnt));
        }
      }

      // Pull agent.budgetCapUsd once for the cost-utilization math.
      const [agentRow] = await db
        .select({ budgetCapUsd: agents.budgetCapUsd })
        .from(agents)
        .where(eq(agents.id, input.agentId));
      const capUsd = Number(agentRow?.budgetCapUsd ?? 0);

      const samples: RunSample[] = rows.map((r) => {
        const h = (r.highlights ?? {}) as Record<string, unknown>;
        const verification = (h.verification as { passed?: boolean } | undefined) ?? {};
        const scopeLock =
          (h.scope_lock as { refused_expansion_attempts?: unknown[] } | undefined) ?? {};
        const outputQuality = (h.output_quality as { passed?: boolean } | undefined) ?? {};

        // Approval signal: approvalCount > 0 means the run cycled. We don't
        // distinguish approve vs reject from run_summaries alone — that lives
        // in relay_events approval.resolved. For v1, treat approvalCount > 0
        // AND status === "done" as approved; status === "failed" with
        // approvalCount > 0 as rejected.
        const approvalCycled = (r.approvalCount ?? 0) > 0;
        const approved = approvalCycled && r.status === "done";
        const rejected = approvalCycled && r.status === "failed";

        return {
          status: r.status,
          verificationPassed: verification.passed === true,
          approvalApproved: approved,
          approvalRejected: rejected,
          costUsd: Number(r.costActualUsd ?? 0),
          budgetCapUsd: capUsd,
          findingsHighMed: r.findingCount ?? 0,
          cantfailEventCount: cantfailCounts.get(r.runId) ?? 0,
          scopeLockRefusals: (scopeLock.refused_expansion_attempts ?? []).length,
          outputQualityFailed: outputQuality.passed === false,
        };
      });

      return samples;
    },

    persistScorecard: async (sc) => {
      const [row] = await db
        .insert(agentScorecards)
        .values({
          tenantId: sc.tenantId,
          agentId: sc.agentId,
          agentKey: sc.agentKey,
          windowStart: sc.windowStart,
          windowEnd: sc.windowEnd,
          sampleSize: sc.sampleSize,
          verificationRate: sc.verificationRate?.toString() ?? null,
          approvalRate: sc.approvalRate?.toString() ?? null,
          avgCostUtilization: sc.avgCostUtilization.toString(),
          findingsRatePerRun: sc.findingsRatePerRun.toString(),
          scopeLockRefusalsPerRun: sc.scopeLockRefusalsPerRun.toString(),
          outputQualityFailureRate: sc.outputQualityFailureRate.toString(),
          cantfailEvents: sc.cantfailEvents,
          verdict: sc.verdict,
          rationale: sc.rationale,
          triggeredThresholds: sc.triggeredThresholds,
        })
        .returning({ id: agentScorecards.id });
      if (!row) throw new Error("persistScorecard: insert returned no row");
      return row.id;
    },

    applyAutonomy: async (a) => {
      const result = await setAutonomy(db, {
        tenantId: a.tenantId,
        agentId: a.agentId,
        nextAutonomy: a.nextAutonomy,
        reason: a.reason,
      });
      return result ? { id: result.id, autonomy: result.autonomy } : null;
    },

    markApplied: async (m) => {
      await db
        .update(agentScorecards)
        .set({
          appliedAt: m.appliedAt,
          appliedAutonomy: m.appliedAutonomy,
        })
        .where(eq(agentScorecards.id, m.scorecardId));
    },
  };
}

/**
 * scoreAgentsScheduled — Inngest function. Triggered by either:
 *   - cron: every 6 hours sweep all active agents per tenant
 *   - event: `agent/score-now { agentId, tenantId }` for ad-hoc rescoring
 *
 * Step structure: fetch agent list, fan-out one step per agent (so retries
 * are bounded to a single agent at a time).
 */
export const scoreAgentsScheduled = inngest.createFunction(
  {
    id: "score-agents-scheduled",
    concurrency: { limit: 3 },
    triggers: [
      { cron: "0 */6 * * *" },
      { event: "agent/score-now" },
    ],
  },
  async ({ event, step }) => {
    const data = (event.data ?? {}) as { agentId?: string; tenantId?: string };

    if (!process.env.DATABASE_URL) {
      return { scored: 0, reason: "DATABASE_URL unset; cannot score" };
    }
    const db = createDb(process.env.DATABASE_URL);

    // Resolve which agents to score: ad-hoc event passes (agentId, tenantId);
    // cron walks all active agents.
    const targets = await step.run("resolve-targets", async () => {
      if (data.agentId && data.tenantId) {
        const [row] = await db
          .select({
            id: agents.id,
            key: agents.key,
            tenantId: agents.tenantId,
            autonomy: agents.autonomy,
          })
          .from(agents)
          .where(and(eq(agents.id, data.agentId), eq(agents.tenantId, data.tenantId)));
        return row ? [row] : [];
      }
      return await db
        .select({
          id: agents.id,
          key: agents.key,
          tenantId: agents.tenantId,
          autonomy: agents.autonomy,
        })
        .from(agents)
        .where(eq(agents.lifecycleState, "active"));
    });

    const sink = buildSink(db);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days

    let scored = 0;
    const results: { agentKey: string; verdict: string; appliedAutonomy: string }[] = [];

    for (const t of targets) {
      const res = await step.run(`score-${t.id}`, async () => {
        return await runScorecardJob(
          {
            tenantId: t.tenantId,
            agentId: t.id,
            agentKey: t.key,
            currentAutonomy: (t.autonomy as Autonomy) ?? "propose",
            isCantFail: isCantFail(t.key),
            windowStart,
            windowEnd,
          },
          sink,
        );
      });
      scored++;
      results.push({
        agentKey: res.agentKey,
        verdict: res.verdict,
        appliedAutonomy: res.appliedAutonomy,
      });
    }

    return { scored, results };
  },
);
