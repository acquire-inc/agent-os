// Agent evaluator scorecard — pure module.
//
// The doctrine claim (CLAUDE.md): "promotion is earned from eval/approval-rate
// metrics; demotion is automatic on drops." This module is the math that
// makes that claim load-bearing instead of aspirational. It does NOT touch
// the database — callers fetch run_summaries + relay events from the
// per-tenant window and pass them in. The scorecard returns a verdict.
//
// A downstream scheduled job (separate phase) walks each agent, calls
// scoreAgent(runs), and writes the verdict to a new agent_scorecards table
// + (when verdict moves) calls the lifecycle setAutonomy() helper.
//
// Verdict thresholds are conservative defaults — agents move slowly. The
// thresholds are caller-overridable so the agent-onboarder can run a
// tighter cycle for new agents.

export interface RunSample {
  /** Terminal status of the run. */
  status: "done" | "failed" | "escalated" | "skipped" | "quarantined";
  /** True iff the agent's verification step (verification-before-completion
   *  skill) reported clean. Read from run_summaries.highlights.verification.passed. */
  verificationPassed: boolean;
  /** True iff the run was on autonomy=propose and the operator approved it
   *  (read from approval.resolved Relay event with kind=approve). */
  approvalApproved: boolean;
  /** True iff the run was on autonomy=propose and the operator rejected.
   *  Mutually exclusive with approvalApproved. */
  approvalRejected: boolean;
  /** Actual cost in USD. */
  costUsd: number;
  /** Budget cap at run start (the run's effective cap). */
  budgetCapUsd: number;
  /** Number of finding.recorded events for this run with severity >= medium. */
  findingsHighMed: number;
  /** Number of cantfail.* events for this run. Any > 0 = automatic demotion floor. */
  cantfailEventCount: number;
  /** True iff scope_lock.refused_expansion_attempts.length > 0
   *  (from the scope-lock-discipline skill) — drift signal. */
  scopeLockRefusals: number;
  /** True iff the output-quality-gate skill RAN on this run (i.e. the agent
   *  is bound to the skill and it produced a verdict). Read from
   *  highlights.output_quality !== undefined. CR-02 fix: previously the
   *  predicate was tautological — every run was counted as a skill application
   *  regardless of whether the skill ran. */
  outputQualityApplied: boolean;
  /** True iff outputQualityApplied AND output_quality.passed === false. */
  outputQualityFailed: boolean;
}

export interface ScorecardThresholds {
  /** Minimum sample window before a promotion verdict can fire. */
  minSampleSize: number;
  /** Minimum approval rate to be eligible for promotion. */
  minApprovalRateForPromote: number;
  /** Minimum verification pass rate to stay at current autonomy. */
  minVerificationRate: number;
  /** Max average cost-cap utilization (cost / cap) tolerated. */
  maxCostUtilization: number;
  /** Demote if findings-rate (per run) exceeds this. */
  maxFindingsRatePerRun: number;
  /** Demote if scope-lock refusals per run exceed this. */
  maxScopeLockRefusalsPerRun: number;
  /** Demote if output-quality failure rate exceeds this. */
  maxOutputQualityFailureRate: number;
  /** Promote bar — tighter than minVerificationRate. WR-07 fix: was hardcoded. */
  minVerificationRateForPromote: number;
  /** Promote bar — cost util must be below this. WR-07 fix: was hardcoded. */
  maxCostUtilizationForPromote: number;
}

export const DEFAULT_THRESHOLDS: ScorecardThresholds = {
  minSampleSize: 20,
  minApprovalRateForPromote: 0.9,
  minVerificationRate: 0.85,
  minVerificationRateForPromote: 0.95,
  maxCostUtilization: 0.85,
  maxCostUtilizationForPromote: 0.765, // 0.9 * 0.85 — was hardcoded as a multiplier
  maxFindingsRatePerRun: 0.1,
  maxScopeLockRefusalsPerRun: 0.5,
  maxOutputQualityFailureRate: 0.1,
};

export type Verdict =
  | "promote"
  | "hold"
  | "demote"
  | "force_demote_safety"
  | "insufficient_data";

export interface Scorecard {
  /** N runs in the input window. */
  sampleSize: number;
  /** sum(verificationPassed) / sampleSize. */
  verificationRate: number;
  /** sum(approvalApproved) / (approvalApproved + approvalRejected). NaN if
   *  no approval cycle ran in the window (e.g. agent is execute_safe). */
  approvalRate: number;
  /** Average of (costUsd / budgetCapUsd) across runs where cap > 0. */
  avgCostUtilization: number;
  /** Average findings (severity>=medium) per run. */
  findingsRatePerRun: number;
  /** Average scope-lock refusals per run. */
  scopeLockRefusalsPerRun: number;
  /** Failure rate of output-quality-gate where it applied. */
  outputQualityFailureRate: number;
  /** Total cantfail.* events across the window. */
  cantfailEvents: number;
  /** The verdict — what the lifecycle controller should do. */
  verdict: Verdict;
  /** Human-readable reason for the verdict. */
  rationale: string;
  /** Which threshold(s) tripped — empty if hold/promote. */
  triggeredThresholds: string[];
}

/**
 * Compute the scorecard for an agent's recent runs.
 *
 * Walks the sample window once, derives the rates, then runs three layered
 * checks:
 *   1. Force-demote if any cantfail.* event landed (safety floor — unconditional).
 *   2. Demote if ANY other threshold is tripped beyond tolerance.
 *   3. Hold/promote based on approval + verification + cost utilization.
 *
 * Insufficient_data is returned when the sample is smaller than
 * thresholds.minSampleSize. The lifecycle controller should leave the
 * agent at its current autonomy in that case (no promote, no demote).
 */
export function scoreAgent(
  runs: readonly RunSample[],
  thresholds: ScorecardThresholds = DEFAULT_THRESHOLDS,
): Scorecard {
  const sampleSize = runs.length;

  let verificationPassedCount = 0;
  let approvalApprovedCount = 0;
  let approvalCycledCount = 0;
  let costUtilSum = 0;
  let costUtilSamples = 0;
  let findingsSum = 0;
  let scopeLockRefusalsSum = 0;
  let outputQualityFailures = 0;
  let outputQualityApplications = 0;
  let cantfailEvents = 0;

  for (const r of runs) {
    if (r.verificationPassed) verificationPassedCount++;
    if (r.approvalApproved) {
      approvalApprovedCount++;
      approvalCycledCount++;
    }
    if (r.approvalRejected) approvalCycledCount++;
    if (r.budgetCapUsd > 0) {
      costUtilSum += r.costUsd / r.budgetCapUsd;
      costUtilSamples++;
    }
    findingsSum += r.findingsHighMed;
    scopeLockRefusalsSum += r.scopeLockRefusals;
    // CR-02 fix: only count runs where the output-quality-gate skill actually
    // ran. Previously the guard was tautological (`x || !x`) which counted
    // every run as a skill application — corrupted the rate for the vast
    // majority of agents (only 4 are bound to output-quality-gate).
    if (r.outputQualityApplied) {
      outputQualityApplications++;
      if (r.outputQualityFailed) outputQualityFailures++;
    }
    cantfailEvents += r.cantfailEventCount;
  }

  const verificationRate = sampleSize > 0 ? verificationPassedCount / sampleSize : 0;
  const approvalRate =
    approvalCycledCount > 0 ? approvalApprovedCount / approvalCycledCount : Number.NaN;
  const avgCostUtilization = costUtilSamples > 0 ? costUtilSum / costUtilSamples : 0;
  const findingsRatePerRun = sampleSize > 0 ? findingsSum / sampleSize : 0;
  const scopeLockRefusalsPerRun = sampleSize > 0 ? scopeLockRefusalsSum / sampleSize : 0;
  const outputQualityFailureRate =
    outputQualityApplications > 0 ? outputQualityFailures / outputQualityApplications : 0;

  const triggered: string[] = [];

  // Layer 1: cantfail safety floor — unconditional force-demote.
  if (cantfailEvents > 0) {
    return {
      sampleSize,
      verificationRate,
      approvalRate,
      avgCostUtilization,
      findingsRatePerRun,
      scopeLockRefusalsPerRun,
      outputQualityFailureRate,
      cantfailEvents,
      verdict: "force_demote_safety",
      rationale: `${cantfailEvents} cantfail.* event(s) in window — automatic demotion to propose, no override`,
      triggeredThresholds: ["cantfailEvents > 0"],
    };
  }

  // Sample-size gate.
  if (sampleSize < thresholds.minSampleSize) {
    return {
      sampleSize,
      verificationRate,
      approvalRate,
      avgCostUtilization,
      findingsRatePerRun,
      scopeLockRefusalsPerRun,
      outputQualityFailureRate,
      cantfailEvents,
      verdict: "insufficient_data",
      rationale: `${sampleSize} runs < minimum ${thresholds.minSampleSize} — no verdict; hold current autonomy`,
      triggeredThresholds: [],
    };
  }

  // Layer 2: demote thresholds. Any single trip moves the agent down.
  if (verificationRate < thresholds.minVerificationRate) {
    triggered.push(`verificationRate ${verificationRate.toFixed(2)} < ${thresholds.minVerificationRate}`);
  }
  if (avgCostUtilization > thresholds.maxCostUtilization) {
    triggered.push(`avgCostUtilization ${avgCostUtilization.toFixed(2)} > ${thresholds.maxCostUtilization}`);
  }
  if (findingsRatePerRun > thresholds.maxFindingsRatePerRun) {
    triggered.push(`findingsRatePerRun ${findingsRatePerRun.toFixed(2)} > ${thresholds.maxFindingsRatePerRun}`);
  }
  if (scopeLockRefusalsPerRun > thresholds.maxScopeLockRefusalsPerRun) {
    triggered.push(`scopeLockRefusalsPerRun ${scopeLockRefusalsPerRun.toFixed(2)} > ${thresholds.maxScopeLockRefusalsPerRun}`);
  }
  if (outputQualityFailureRate > thresholds.maxOutputQualityFailureRate) {
    triggered.push(`outputQualityFailureRate ${outputQualityFailureRate.toFixed(2)} > ${thresholds.maxOutputQualityFailureRate}`);
  }

  if (triggered.length > 0) {
    return {
      sampleSize,
      verificationRate,
      approvalRate,
      avgCostUtilization,
      findingsRatePerRun,
      scopeLockRefusalsPerRun,
      outputQualityFailureRate,
      cantfailEvents,
      verdict: "demote",
      rationale: `${triggered.length} threshold(s) tripped: ${triggered.join("; ")}`,
      triggeredThresholds: triggered,
    };
  }

  // Layer 3: promote vs hold. Promote requires approval rate clearance AND
  // verification clearance AND not at the cost-utilization ceiling. NaN
  // approval rate (no approval cycle) defaults to "hold" — agent must
  // earn its way via an approval cycle.
  const approvalClear =
    !Number.isNaN(approvalRate) && approvalRate >= thresholds.minApprovalRateForPromote;
  const verificationClear = verificationRate >= thresholds.minVerificationRateForPromote;
  const costClear = avgCostUtilization < thresholds.maxCostUtilizationForPromote;

  if (approvalClear && verificationClear && costClear) {
    return {
      sampleSize,
      verificationRate,
      approvalRate,
      avgCostUtilization,
      findingsRatePerRun,
      scopeLockRefusalsPerRun,
      outputQualityFailureRate,
      cantfailEvents,
      verdict: "promote",
      rationale: `approval=${approvalRate.toFixed(2)} verification=${verificationRate.toFixed(2)} cost_util=${avgCostUtilization.toFixed(2)} — all promote thresholds clear`,
      triggeredThresholds: [],
    };
  }

  // Hold: not enough to demote, not enough to promote.
  const holdReasons: string[] = [];
  if (Number.isNaN(approvalRate)) holdReasons.push("no approval cycle in window");
  if (!Number.isNaN(approvalRate) && !approvalClear) holdReasons.push(`approval ${approvalRate.toFixed(2)} < ${thresholds.minApprovalRateForPromote}`);
  if (!verificationClear) holdReasons.push(`verification ${verificationRate.toFixed(2)} < ${thresholds.minVerificationRateForPromote} (promote bar)`);
  if (!costClear) holdReasons.push(`cost_util ${avgCostUtilization.toFixed(2)} >= ${thresholds.maxCostUtilizationForPromote} (promote bar)`);

  return {
    sampleSize,
    verificationRate,
    approvalRate,
    avgCostUtilization,
    findingsRatePerRun,
    scopeLockRefusalsPerRun,
    outputQualityFailureRate,
    cantfailEvents,
    verdict: "hold",
    rationale: `not promote-eligible: ${holdReasons.join("; ")}`,
    triggeredThresholds: [],
  };
}
