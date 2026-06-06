// Phase 44: feedback loop from production runs into the model catalog.
//
// The catalog (Phase 38) seeds `capability_scores` from operator intuition.
// Over time, real production runs accumulate signal — verification pass
// rates, output-quality verdicts, finding counts. This module turns that
// signal into proposed capability_score updates so the picker gets
// smarter without operator hand-tuning.
//
// Design choice: this is a pure module. It takes ModelRunObservation[]
// (one per run, identifying which model handled it) plus the current
// catalog snapshot and returns proposed updates. The actual UPDATE on
// models.capability_scores is the caller's job (a scheduled Inngest
// function reviews and writes; the operator can also review-then-apply
// via a dashboard surface).
//
// Safety guards:
//   - We blend slowly: each cycle moves each score at most BLEND_RATE
//     toward the observed signal. Prevents single bad runs from tanking
//     a model's score.
//   - Sample-size floor: a capability needs MIN_SAMPLES recent runs
//     before its score gets updated.
//   - No downward updates below FLOOR_SCORE: we don't want a flaky
//     window to drop a known-good model into "uneligible" territory.
//   - T-critical models are NEVER updated by this loop — their scores
//     are doctrine, not observed.

import type { CapabilityKey, ModelCatalogEntry } from "./intelligence.js";

const BLEND_RATE = 0.1; // 10% movement per cycle
const MIN_SAMPLES = 10;
const FLOOR_SCORE = 3;
const NEUTRAL = 5;

export interface ModelRunObservation {
  /** The model slug that handled this run. */
  modelSlug: string;
  /** Which capability the run primarily exercised. Derived by the caller
   *  from the agent's primary skill's task_profile (the highest-weighted
   *  capability), or from the per-task fork that selected this model. */
  capability: CapabilityKey;
  /** verification.passed && !outputQualityFailed && cantfailEvents === 0
   *  -> 10; partial pass -> 5; verification.passed === false -> 1.
   *  See deriveOutcomeScore() for the canonical mapping. */
  outcomeScore: number;
  /** Optional finding count for richer signal. */
  highSeverityFindings?: number;
}

export interface ProposedScoreUpdate {
  modelSlug: string;
  capability: CapabilityKey;
  currentScore: number;
  observedScore: number;
  proposedScore: number;
  sampleSize: number;
  /** Why this update is being proposed (audit + operator review). */
  rationale: string;
}

/** Map a per-run highlights record to a single 0..10 outcome score.
 *  The caller invokes this on each run; the result feeds aggregator. */
export function deriveOutcomeScore(args: {
  verificationPassed: boolean;
  outputQualityApplied: boolean;
  outputQualityFailed: boolean;
  cantfailEvents: number;
  highSeverityFindings: number;
}): number {
  // Cantfail kills the run's outcome regardless of anything else.
  if (args.cantfailEvents > 0) return 0;
  // Verification fail = strong negative signal.
  if (!args.verificationPassed) return 2;
  // Output-quality applied + failed = negative signal.
  if (args.outputQualityApplied && args.outputQualityFailed) return 4;
  // Findings degrade the score.
  if (args.highSeverityFindings >= 2) return 6;
  if (args.highSeverityFindings === 1) return 7;
  // Clean run.
  return args.outputQualityApplied ? 10 : 9;
}

/**
 * Aggregate observations by (modelSlug, capability) and propose blended
 * score updates. Returns one ProposedScoreUpdate per (model, capability)
 * combination with sufficient samples.
 */
export function aggregateModelObservations(
  observations: readonly ModelRunObservation[],
  catalog: readonly ModelCatalogEntry[],
): ProposedScoreUpdate[] {
  // Bucket observations by (modelSlug, capability).
  const buckets = new Map<string, ModelRunObservation[]>();
  for (const obs of observations) {
    const key = `${obs.modelSlug}::${obs.capability}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(obs);
  }

  const proposals: ProposedScoreUpdate[] = [];
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.length < MIN_SAMPLES) continue;
    const [modelSlug, capabilityRaw] = bucketKey.split("::");
    if (!modelSlug || !capabilityRaw) continue;
    const capability = capabilityRaw as CapabilityKey;

    const model = catalog.find((m) => m.slug === modelSlug);
    if (!model) continue;
    // T-critical models are doctrine — never auto-updated.
    if (model.tierAffinity === "T-critical") continue;
    if (!model.enabled) continue;
    if (model.status === "deprecated") continue;

    const currentScore = model.capabilityScores[capability] ?? NEUTRAL;
    const observedScore =
      bucket.reduce((sum, o) => sum + o.outcomeScore, 0) / bucket.length;

    // Blend currentScore toward observedScore.
    const delta = observedScore - currentScore;
    const movement = delta * BLEND_RATE;
    let proposedScore = currentScore + movement;

    // Apply the floor — never propose below FLOOR_SCORE (prevents flaky
    // window from making a known-good model uneligible).
    if (proposedScore < FLOOR_SCORE) proposedScore = FLOOR_SCORE;
    // Cap at 10 — capability_scores are 0..10.
    if (proposedScore > 10) proposedScore = 10;
    // Round to 1 decimal for stable storage.
    proposedScore = Math.round(proposedScore * 10) / 10;

    // Skip no-op proposals to keep the audit trail meaningful.
    if (Math.abs(proposedScore - currentScore) < 0.05) continue;

    const direction = proposedScore > currentScore ? "↑" : "↓";
    const rationale = `${modelSlug}/${capability}: ${currentScore.toFixed(1)} ${direction} ${proposedScore.toFixed(1)} from ${bucket.length} runs (observed avg ${observedScore.toFixed(2)})`;

    proposals.push({
      modelSlug,
      capability,
      currentScore,
      observedScore,
      proposedScore,
      sampleSize: bucket.length,
      rationale,
    });
  }

  return proposals;
}
