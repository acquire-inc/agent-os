// Phase 21: Scorecard job — orchestrates per-agent eval scoring + autonomy
// mutation. The job is a pure function that takes a "data fetcher" interface
// so it can be exercised by a unit test without a live db.
//
// Production wiring (separate phase): an Inngest scheduled function (or cron)
// walks the active agent list per-tenant, builds the fetcher via Drizzle
// queries, and calls runScorecardJob(). The job persists a scorecard row,
// computes the next autonomy, and (on changed=true) calls setAutonomy.
//
// Doctrine: this is the only path that mutates autonomy based on eval signal.
// Manual operator overrides go through a different endpoint (out of scope
// here). force_demote_safety always wins regardless of operator overrides.

import { computeNextAutonomy, type Autonomy } from "./controller.js";
import { DEFAULT_THRESHOLDS, scoreAgent, type RunSample, type ScorecardThresholds, type Verdict } from "./scorecard.js";

export interface ScorecardJobInputs {
  tenantId: string;
  agentId: string;
  agentKey: string;
  currentAutonomy: Autonomy;
  isCantFail: boolean;
  windowStart: Date;
  windowEnd: Date;
  thresholds?: ScorecardThresholds;
}

export interface ScorecardJobSink {
  /** Fetch the agent's window of run samples. */
  fetchRunSamples: (input: ScorecardJobInputs) => Promise<RunSample[]>;
  /** Persist the scorecard row to agent_scorecards. Returns the inserted id. */
  persistScorecard: (
    scorecard: {
      tenantId: string;
      agentId: string;
      agentKey: string;
      windowStart: Date;
      windowEnd: Date;
      sampleSize: number;
      verificationRate: number | null;
      approvalRate: number | null;
      avgCostUtilization: number;
      findingsRatePerRun: number;
      scopeLockRefusalsPerRun: number;
      outputQualityFailureRate: number;
      cantfailEvents: number;
      verdict: Verdict;
      rationale: string;
      triggeredThresholds: string[];
    },
  ) => Promise<string>;
  /** Apply the autonomy mutation. Returns null on no-op (current === next). */
  applyAutonomy: (args: {
    tenantId: string;
    agentId: string;
    nextAutonomy: Autonomy;
    reason: string;
  }) => Promise<{ id: string; autonomy: string } | null>;
  /** Mark the scorecard row as applied. */
  markApplied: (args: {
    scorecardId: string;
    appliedAutonomy: string;
    appliedAt: Date;
  }) => Promise<void>;
}

export interface ScorecardJobResult {
  agentId: string;
  agentKey: string;
  verdict: Verdict;
  sampleSize: number;
  scorecardId: string;
  nextAutonomy: Autonomy;
  autonomyChanged: boolean;
  appliedAutonomy: string;
  rationale: string;
}

/**
 * Run the scorecard job for one agent. Returns the full decision trace.
 *
 * The job does not throw on data-not-found — small or empty windows fall
 * through to verdict=insufficient_data, which is the controller's no-op
 * case. The only path that throws is if the sink throws (db error, etc).
 */
export async function runScorecardJob(
  inputs: ScorecardJobInputs,
  sink: ScorecardJobSink,
): Promise<ScorecardJobResult> {
  const thresholds = inputs.thresholds ?? DEFAULT_THRESHOLDS;
  const samples = await sink.fetchRunSamples(inputs);
  const card = scoreAgent(samples, thresholds);

  const scorecardId = await sink.persistScorecard({
    tenantId: inputs.tenantId,
    agentId: inputs.agentId,
    agentKey: inputs.agentKey,
    windowStart: inputs.windowStart,
    windowEnd: inputs.windowEnd,
    sampleSize: card.sampleSize,
    verificationRate: Number.isNaN(card.verificationRate) ? null : card.verificationRate,
    approvalRate: Number.isNaN(card.approvalRate) ? null : card.approvalRate,
    avgCostUtilization: card.avgCostUtilization,
    findingsRatePerRun: card.findingsRatePerRun,
    scopeLockRefusalsPerRun: card.scopeLockRefusalsPerRun,
    outputQualityFailureRate: card.outputQualityFailureRate,
    cantfailEvents: card.cantfailEvents,
    verdict: card.verdict,
    rationale: card.rationale,
    triggeredThresholds: card.triggeredThresholds,
  });

  const decision = computeNextAutonomy(inputs.currentAutonomy, card.verdict, inputs.isCantFail);

  let appliedAutonomy = "unchanged";
  if (decision.changed) {
    const updated = await sink.applyAutonomy({
      tenantId: inputs.tenantId,
      agentId: inputs.agentId,
      nextAutonomy: decision.nextAutonomy,
      reason: `scorecard verdict=${card.verdict}: ${card.rationale}`,
    });
    appliedAutonomy = updated?.autonomy ?? "unchanged";
  }

  await sink.markApplied({
    scorecardId,
    appliedAutonomy,
    appliedAt: new Date(),
  });

  return {
    agentId: inputs.agentId,
    agentKey: inputs.agentKey,
    verdict: card.verdict,
    sampleSize: card.sampleSize,
    scorecardId,
    nextAutonomy: decision.nextAutonomy,
    autonomyChanged: decision.changed,
    appliedAutonomy,
    rationale: decision.rationale,
  };
}
