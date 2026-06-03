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
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
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
          // WR-01: findingCount removed from the select — we now query
          // relay_events for severity-filtered counts (see below).
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

      // For each run, count cantfail.* + medium-or-higher findings in relay_events.
      const runIds = rows.map((r) => r.runId);
      const cantfailCounts = new Map<string, number>();
      const findingsHighMedCounts = new Map<string, number>();
      if (runIds.length > 0) {
        // CR-03 fix: use parameterized inArray() instead of sql.raw() with
        // manually-quoted UUID literals. Defense-in-depth against any future
        // refactor that sources runIds from a less-trusted path.
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
              inArray(relayEvents.runId, runIds),
            ),
          )
          .groupBy(relayEvents.runId);
        for (const cf of cfRows) {
          if (cf.runId) cantfailCounts.set(cf.runId, Number(cf.cnt));
        }

        // WR-01 fix: only count finding.recorded events whose payload.severity
        // is in {medium, high, critical}. Previously the sink read
        // run_summaries.findingCount which is a total across all severities;
        // chatty low-severity findings tripped the maxFindingsRatePerRun
        // threshold (0.1) and demoted agents on noise.
        const findingRows = await db
          .select({
            runId: relayEvents.runId,
            cnt: count().as("cnt"),
          })
          .from(relayEvents)
          .where(
            and(
              eq(relayEvents.tenantId, input.tenantId),
              eq(relayEvents.eventName, "finding.recorded"),
              inArray(relayEvents.runId, runIds),
              sql`(${relayEvents.payload}->>'severity') IN ('medium','high','critical')`,
            ),
          )
          .groupBy(relayEvents.runId);
        for (const f of findingRows) {
          if (f.runId) findingsHighMedCounts.set(f.runId, Number(f.cnt));
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
        // CR-02 fix: distinguish "skill applied" from "skill failed". The
        // output-quality-gate skill only runs on the 4 agents bound to it;
        // every other run should not be counted as an application.
        const outputQualityRaw = h.output_quality;
        const outputQualityApplied = outputQualityRaw !== undefined && outputQualityRaw !== null;
        const outputQuality = (outputQualityRaw as { passed?: boolean } | undefined) ?? {};

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
          findingsHighMed: findingsHighMedCounts.get(r.runId) ?? 0,
          cantfailEventCount: cantfailCounts.get(r.runId) ?? 0,
          scopeLockRefusals: (scopeLock.refused_expansion_attempts ?? []).length,
          outputQualityApplied,
          outputQualityFailed: outputQualityApplied && outputQuality.passed === false,
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
    const failed: { agentKey: string; error: string }[] = [];

    // CR-09 fix: wrap each step.run in try/catch so one bad agent doesn't
    // halt the entire sweep. Without isolation, Inngest's function-level
    // retry stampedes every agent on every retry attempt, eventually
    // silently exhausting retries and stopping scoring for everyone.
    for (const t of targets) {
      try {
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
      } catch (e) {
        const msg = (e as Error).message;
        failed.push({ agentKey: t.key, error: msg });
        console.error(`[scoreAgents] failed to score ${t.key}: ${msg}`);
      }
    }

    return { scored, failed_count: failed.length, results, failed };
  },
);
