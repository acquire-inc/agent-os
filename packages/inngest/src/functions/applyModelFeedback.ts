// Phase 45: scheduled model-feedback application.
//
// Triggered monthly (or on-demand via event). Walks the last 30 days of
// run_summaries + relay_events, derives per-(model, capability) outcome
// scores via deriveOutcomeScore, aggregates via aggregateModelObservations,
// persists each proposal to model_feedback_proposals, and applies
// proposals that clear the auto-apply guardrails to models.capability_scores.
//
// Auto-apply guardrails:
//   - status='pending' (not already actioned)
//   - sample_size >= 30 (tighter than the aggregator's 10)
//   - movement <= 0.5 absolute (single-cycle clamp)
//   - model.enabled = true and status != 'deprecated'
//
// Anything that fails the auto-apply guardrails stays pending for the
// operator dashboard to review.

import { createDb, schema, type Db } from "@agent-os/db";
import {
  aggregateModelObservations,
  deriveOutcomeScore,
  type CapabilityKey,
  type ModelCatalogEntry,
  type ModelRunObservation,
  type ProposedScoreUpdate,
} from "@agent-os/core";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { inngest } from "../client.js";

const AUTO_APPLY_MIN_SAMPLES = 30;
const AUTO_APPLY_MAX_DELTA = 0.5;

async function loadCatalog(db: Db): Promise<ModelCatalogEntry[]> {
  const rows = await db.select().from(schema.models).where(eq(schema.models.enabled, true));
  return rows.map((r) => ({
    slug: r.slug,
    provider: r.provider,
    family: r.family,
    status: r.status,
    costInputPerMillionUsd: Number(r.costInputPerMillionUsd),
    costOutputPerMillionUsd: Number(r.costOutputPerMillionUsd),
    contextWindowTokens: r.contextWindowTokens,
    maxOutputTokens: r.maxOutputTokens,
    supportsTools: r.supportsTools,
    supportsReasoning: r.supportsReasoning,
    supportsVision: r.supportsVision,
    supportsStreaming: r.supportsStreaming,
    capabilityScores: (r.capabilityScores ?? {}) as Record<string, number>,
    tierAffinity: r.tierAffinity ?? null,
    enabled: r.enabled,
  }));
}

/**
 * Read the last `windowDays` of run_summaries, join to relay_events for
 * cantfail + finding counts, and produce one ModelRunObservation per run.
 *
 * For each run we need: model_slug + capability + outcome_score.
 *   - model_slug: the run's effective model. Sourced from the most recent
 *     model.routed event for the run if any (forked-to slug); falls back
 *     to runs.* table joined to agents.model. For v1 we use agents.model
 *     joined via run -> agent_id, which gives us the dispatch model (not
 *     per-tool fork). Per-tool forks land in model.routed; a follow-up
 *     phase can read those for finer attribution.
 *   - capability: derived from the agent's primary skill's task_profile
 *     (the highest-weighted capability). When no profile exists we
 *     default to a neutral capability key based on the agent class.
 *   - outcome_score: deriveOutcomeScore against highlights + finding count.
 */
async function loadObservations(db: Db, windowDays: number): Promise<ModelRunObservation[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // Pull run_summaries + agents.model. Join to securityFindings count
  // (severity >= medium) per run via subquery.
  const rows = await db
    .select({
      runId: schema.runSummaries.runId,
      agentKey: schema.agents.key,
      model: schema.agents.model,
      status: schema.runSummaries.status,
      highlights: schema.runSummaries.highlights,
    })
    .from(schema.runSummaries)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.runSummaries.agentId))
    .where(gte(schema.runSummaries.endedAt, since))
    .orderBy(desc(schema.runSummaries.endedAt))
    .limit(5000);

  // Per-run cantfail event counts.
  const cantfailCounts = new Map<string, number>();
  const runIds = rows.map((r) => r.runId);
  if (runIds.length > 0) {
    const cf = await db
      .select({ runId: schema.relayEvents.runId, cnt: sql<number>`count(*)::int` })
      .from(schema.relayEvents)
      .where(
        and(
          sql`${schema.relayEvents.eventName} LIKE 'cantfail.%'`,
          sql`${schema.relayEvents.runId} = ANY(${runIds})`,
        ),
      )
      .groupBy(schema.relayEvents.runId);
    for (const r of cf) {
      if (r.runId) cantfailCounts.set(r.runId, Number(r.cnt));
    }
  }

  // CR-04 fix: identify runs where a per-task model fork ACTUALLY
  // ran. Today, no fork actually applies (audit-only; the SDK call
  // stays on baseline), so we exclude any run where the audit shows
  // an applied: true model.routed event. When Phase 52 lands real
  // SDK re-targeting, those runs will be attributed via the routed
  // event's recommended_slug — but until then, we err on the side of
  // skipping the run from feedback rather than crediting the wrong
  // model. v1 conservative path.
  const forkedRunIds = new Set<string>();
  if (runIds.length > 0) {
    const forked = await db
      .select({ runId: schema.relayEvents.runId, payload: schema.relayEvents.payload })
      .from(schema.relayEvents)
      .where(
        and(
          eq(schema.relayEvents.eventName, "model.routed"),
          sql`${schema.relayEvents.runId} = ANY(${runIds})`,
        ),
      );
    for (const f of forked) {
      const payload = f.payload as Record<string, unknown> | null;
      const applied = payload?.applied as boolean | undefined;
      if (applied === true && f.runId) forkedRunIds.add(f.runId);
    }
  }

  // Per-run high-sev finding counts from relay_events finding.recorded
  // (the WR-01 fix path — severity is in payload).
  const findingCounts = new Map<string, number>();
  if (runIds.length > 0) {
    const f = await db
      .select({ runId: schema.relayEvents.runId, cnt: sql<number>`count(*)::int` })
      .from(schema.relayEvents)
      .where(
        and(
          eq(schema.relayEvents.eventName, "finding.recorded"),
          sql`(${schema.relayEvents.payload}->>'severity') IN ('medium','high','critical')`,
          sql`${schema.relayEvents.runId} = ANY(${runIds})`,
        ),
      )
      .groupBy(schema.relayEvents.runId);
    for (const r of f) {
      if (r.runId) findingCounts.set(r.runId, Number(r.cnt));
    }
  }

  const observations: ModelRunObservation[] = [];
  for (const r of rows) {
    // CR-04 fix: skip runs where the per-task fork actually applied.
    // Attribution to agents.model (baseline) would credit/blame the
    // wrong slug. When Phase 52 lands SDK re-targeting + writes the
    // forked model into a per-run signal, this path will route by
    // recommended_slug instead.
    if (forkedRunIds.has(r.runId)) continue;

    const h = (r.highlights ?? {}) as Record<string, unknown>;
    const verification = (h.verification as { passed?: boolean } | undefined) ?? {};
    const oqRaw = h.output_quality;
    const outputQualityApplied = oqRaw !== undefined && oqRaw !== null;
    const oq = (oqRaw as { passed?: boolean } | undefined) ?? {};
    const cantfailEvents = cantfailCounts.get(r.runId) ?? 0;
    const highSeverityFindings = findingCounts.get(r.runId) ?? 0;

    const outcome = deriveOutcomeScore({
      verificationPassed: verification.passed === true,
      outputQualityApplied,
      outputQualityFailed: outputQualityApplied && oq.passed === false,
      cantfailEvents,
      highSeverityFindings,
    });

    // Derive the primary capability. For v1 we infer from the agent class
    // when no skill profile is available. Classification/triage agents map
    // to classification; reasoning-heavy agents to reasoning; the rest to
    // summarization as a sensible default.
    const capability = inferPrimaryCapability(r.agentKey);

    observations.push({
      modelSlug: r.model,
      capability,
      outcomeScore: outcome,
      highSeverityFindings,
    });
  }

  return observations;
}

function inferPrimaryCapability(agentKey: string): CapabilityKey {
  // Heuristic mapping — overridden by skill task_profile in a follow-up phase.
  if (agentKey.includes("monitor") || agentKey.includes("triage") || agentKey.includes("classifier")) {
    return "classification";
  }
  if (agentKey.includes("architect") || agentKey.includes("critic") || agentKey.includes("decision")) {
    return "reasoning";
  }
  if (agentKey.includes("report") || agentKey.includes("brief") || agentKey.includes("summar")) {
    return "summarization";
  }
  if (agentKey.includes("code") || agentKey.includes("dev")) {
    return "code_generation";
  }
  return "summarization";
}

async function persistProposal(db: Db, proposal: ProposedScoreUpdate): Promise<string> {
  const [row] = await db
    .insert(schema.modelFeedbackProposals)
    .values({
      modelSlug: proposal.modelSlug,
      capability: proposal.capability,
      currentScore: proposal.currentScore.toString(),
      observedScore: proposal.observedScore.toString(),
      proposedScore: proposal.proposedScore.toString(),
      sampleSize: proposal.sampleSize,
      rationale: proposal.rationale,
    })
    .returning({ id: schema.modelFeedbackProposals.id });
  return row?.id ?? "";
}

async function autoApply(db: Db, proposal: ProposedScoreUpdate, proposalId: string): Promise<boolean> {
  const delta = Math.abs(proposal.proposedScore - proposal.currentScore);
  if (proposal.sampleSize < AUTO_APPLY_MIN_SAMPLES) return false;
  if (delta > AUTO_APPLY_MAX_DELTA) return false;

  // CR-06 fix: use jsonb || concatenation. Postgres applies this
  // server-side atomically, so concurrent decisions on different
  // capabilities of the same model don't race.
  const patchJson = JSON.stringify({ [proposal.capability]: proposal.proposedScore });
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE models
      SET capability_scores = capability_scores || ${patchJson}::jsonb,
          last_observed_at = NOW()
      WHERE slug = ${proposal.modelSlug}
    `);
    await tx
      .update(schema.modelFeedbackProposals)
      .set({ status: "applied", appliedAt: new Date(), appliedBy: "applyModelFeedback" })
      .where(eq(schema.modelFeedbackProposals.id, proposalId));
  });
  return true;
}

/**
 * Inngest function. Triggers:
 *   - cron "0 4 1 * *" (monthly, 1st of the month at 04:00 UTC)
 *   - event "model-feedback/apply-now" for ad-hoc runs
 */
export const applyModelFeedback = inngest.createFunction(
  {
    id: "apply-model-feedback",
    concurrency: { limit: 1 },
    triggers: [
      { cron: "0 4 1 * *" },
      { event: "model-feedback/apply-now" },
    ],
  },
  async ({ event, step }) => {
    if (!process.env.DATABASE_URL) {
      return { applied: 0, reason: "DATABASE_URL unset" };
    }
    const db = createDb(process.env.DATABASE_URL);
    const windowDays = (event.data as { windowDays?: number } | undefined)?.windowDays ?? 30;

    const catalog = await step.run("load-catalog", () => loadCatalog(db));
    const observations = await step.run("load-observations", () =>
      loadObservations(db, windowDays),
    );
    const proposals = aggregateModelObservations(observations, catalog);

    let persisted = 0;
    let applied = 0;
    const errors: { proposal: string; error: string }[] = [];

    for (const p of proposals) {
      try {
        const id = await step.run(`persist-${p.modelSlug}-${p.capability}`, () =>
          persistProposal(db, p),
        );
        persisted++;
        const didApply = await step.run(`apply-${p.modelSlug}-${p.capability}`, () =>
          autoApply(db, p, id),
        );
        if (didApply) applied++;
      } catch (e) {
        errors.push({
          proposal: `${p.modelSlug}/${p.capability}`,
          error: (e as Error).message,
        });
      }
    }

    return {
      window_days: windowDays,
      observations_total: observations.length,
      proposals_generated: proposals.length,
      proposals_persisted: persisted,
      proposals_applied: applied,
      errors,
    };
  },
);
