// Model intelligence: pickBestModel scoring algorithm.
//
// Phase 39. Operator request: "pick the best models for that specific
// task" + "if GPT-5.5 scores a 9 and a 10-scoring model is more expensive,
// pick the 9." This is value-per-dollar optimization with task-fit
// weighting.
//
// Inputs:
//   - taskProfile: which capabilities matter and how much, plus any
//     hard requirements (context window, tool support, vision).
//   - catalog: rows from the `models` table (Phase 38). Disabled and
//     deprecated rows are filtered out.
//   - options: cost-vs-quality knob; weight floor; safety floors.
//
// Output: ranked candidates with score breakdown. The caller picks the
// top result (or the operator can offer alternatives in a dashboard).
//
// Safety floors (mirror the rest of the router):
//   - T-critical agents NEVER use this picker — they pin to the
//     CANT_FAIL allowlist. The picker REFUSES to score T-critical
//     candidates for non-T-critical use cases.
//   - Hard requirements (context_window, supports_tools, supports_vision,
//     status='preferred'|'secondary') are pre-filters, not soft scores.
//
// Algorithm:
//   1. Filter candidates by hard requirements + status.
//   2. For each remaining candidate:
//      a. capability_match_score = weighted avg of profile.capabilities,
//         using each capability's score from capabilityScores (missing
//         keys default to neutral 5).
//      b. cost_index = (input_cost + 3 * output_cost) / 4   (3:1 weight
//         reflects typical output-heavy generation)
//      c. cost_penalty = clamp(cost_index / baseline_cost_index, 0.1, 10)
//      d. value_score = capability_match_score / cost_penalty^cost_sensitivity
//         where cost_sensitivity is from profile.costSensitivity:
//           - "low"    -> 0.25  (quality dominates)
//           - "medium" -> 1.0   (default — equal weight)
//           - "high"   -> 2.0   (cost dominates; cheap-and-good wins)
//   3. Floor: if value_score < quality_floor, exclude (caller may want
//      a hard quality bar — the score is on a 0..10-ish scale).
//   4. Rank by value_score desc; return top N with breakdown.

export type CapabilityKey =
  | "reasoning"
  | "tool_use"
  | "classification"
  | "summarization"
  | "code_generation"
  | "multilingual"
  | "vision"
  | "long_context"
  | "factuality"
  | "latency_sensitivity";

export type CostSensitivity = "low" | "medium" | "high";

export interface TaskProfile {
  /** Per-capability weight. Higher = matters more. Missing keys = 0
   *  (don't score). Values are relative; the picker normalizes them. */
  capabilities: Partial<Record<CapabilityKey, number>>;
  /** Hard requirements — fail filter, not soft score. */
  requires?: {
    tools?: boolean;
    vision?: boolean;
    reasoning?: boolean;
    streaming?: boolean;
    minContextTokens?: number;
    minOutputTokens?: number;
    /** Restrict to a provider family (e.g. ["anthropic", "openai"]). */
    providerAllowlist?: string[];
    /** Exclude a provider family. */
    providerBlocklist?: string[];
  };
  /** Cost-vs-quality knob. Default "medium". */
  costSensitivity?: CostSensitivity;
  /** Minimum capability_match_score to be eligible (0..10). Default 0. */
  qualityFloor?: number;
  /** Maximum acceptable cost_index (USD per 1M effective tokens).
   *  Filters out runaway-expensive candidates BEFORE scoring. */
  maxCostIndex?: number;
}

export interface ModelCatalogEntry {
  slug: string;
  provider: string;
  family: string;
  status: "preferred" | "secondary" | "deprecated" | "experimental";
  costInputPerMillionUsd: number;
  costOutputPerMillionUsd: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  capabilityScores: Partial<Record<CapabilityKey, number>>;
  tierAffinity?: "T-trivial" | "T-cheap" | "T-reason" | "T-work" | "T-critical" | null;
  enabled: boolean;
}

export interface ScoredCandidate {
  slug: string;
  provider: string;
  family: string;
  /** 0..10. Capability-weighted average against the profile. */
  capabilityMatchScore: number;
  /** Average USD per million effective tokens (3:1 output:input weight). */
  costIndex: number;
  /** capability / cost_penalty^cost_sensitivity. Ranks the candidates. */
  valueScore: number;
  /** Per-capability score against this candidate, for the rationale. */
  breakdown: Record<string, { weight: number; score: number; contribution: number }>;
  /** Human-readable rationale assembled from the breakdown. */
  rationale: string;
}

export interface PickBestModelOptions {
  /** Hard-exclude T-critical models. Default true — the picker is for
   *  non-T-critical work; T-critical pins to Opus via CANT_FAIL. */
  excludeTCritical?: boolean;
  /** How many candidates to return (top-N). Default 5. */
  topN?: number;
  /** Baseline cost (USD per 1M effective tokens) used to normalize the
   *  cost penalty. Default: $3/M which is roughly Sonnet's price band. */
  baselineCostIndex?: number;
}

const NEUTRAL_SCORE = 5;
const DEFAULT_BASELINE = 3.0;

function costSensitivityExponent(sensitivity: CostSensitivity | undefined): number {
  switch (sensitivity ?? "medium") {
    case "low":
      return 0.25;
    case "medium":
      return 1.0;
    case "high":
      return 2.0;
  }
}

function computeCostIndex(input: number, output: number): number {
  // 3:1 output:input weighting because most AgentOS workloads are
  // generation-heavy (drafts, reports, replies). Tune per-deployment
  // via baselineCostIndex if your workload skews differently.
  return (input + 3 * output) / 4;
}

/**
 * Score one candidate against the task profile. Returns a full breakdown
 * even if the candidate doesn't pass — the picker filters separately.
 */
export function scoreCandidate(
  candidate: ModelCatalogEntry,
  profile: TaskProfile,
  baselineCostIndex: number,
): ScoredCandidate {
  const capabilities = profile.capabilities ?? {};
  const totalWeight = Object.values(capabilities).reduce((sum, w) => sum + (w ?? 0), 0);

  let weighted = 0;
  const breakdown: Record<string, { weight: number; score: number; contribution: number }> = {};

  if (totalWeight === 0) {
    // No capability profile provided — score every candidate at neutral.
    // Cost still differentiates them.
  } else {
    for (const [cap, weight] of Object.entries(capabilities) as [CapabilityKey, number][]) {
      const score = candidate.capabilityScores[cap] ?? NEUTRAL_SCORE;
      const normalizedWeight = weight / totalWeight;
      const contribution = score * normalizedWeight;
      weighted += contribution;
      breakdown[cap] = { weight: normalizedWeight, score, contribution };
    }
  }

  const capabilityMatchScore = totalWeight === 0 ? NEUTRAL_SCORE : weighted;
  const costIndex = computeCostIndex(
    candidate.costInputPerMillionUsd,
    candidate.costOutputPerMillionUsd,
  );
  const costPenalty = Math.min(Math.max(costIndex / baselineCostIndex, 0.1), 10);
  const exp = costSensitivityExponent(profile.costSensitivity);
  const valueScore = capabilityMatchScore / Math.pow(costPenalty, exp);

  const topContribs = Object.entries(breakdown)
    .sort((a, b) => b[1].contribution - a[1].contribution)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v.score.toFixed(1)}`);
  const rationale =
    topContribs.length === 0
      ? `${candidate.slug}: capability score ${capabilityMatchScore.toFixed(1)}/10 at $${costIndex.toFixed(2)}/M -> value ${valueScore.toFixed(2)}`
      : `${candidate.slug}: ${topContribs.join(", ")} | capability ${capabilityMatchScore.toFixed(1)}/10 at $${costIndex.toFixed(2)}/M -> value ${valueScore.toFixed(2)}`;

  return {
    slug: candidate.slug,
    provider: candidate.provider,
    family: candidate.family,
    capabilityMatchScore,
    costIndex,
    valueScore,
    breakdown,
    rationale,
  };
}

/**
 * Filter candidates by hard requirements. Returns the subset that
 * passes every gate. Disabled / deprecated rows are dropped here too.
 */
export function filterCandidates(
  catalog: readonly ModelCatalogEntry[],
  profile: TaskProfile,
  opts: PickBestModelOptions = {},
): ModelCatalogEntry[] {
  const excludeTCritical = opts.excludeTCritical ?? true;
  const requires = profile.requires ?? {};

  return catalog.filter((c) => {
    if (!c.enabled) return false;
    if (c.status === "deprecated") return false;
    if (excludeTCritical && c.tierAffinity === "T-critical") return false;
    if (requires.tools && !c.supportsTools) return false;
    if (requires.vision && !c.supportsVision) return false;
    if (requires.reasoning && !c.supportsReasoning) return false;
    if (requires.streaming && !c.supportsStreaming) return false;
    if (requires.minContextTokens && c.contextWindowTokens < requires.minContextTokens)
      return false;
    if (requires.minOutputTokens && c.maxOutputTokens < requires.minOutputTokens) return false;
    if (
      requires.providerAllowlist &&
      requires.providerAllowlist.length > 0 &&
      !requires.providerAllowlist.includes(c.provider)
    )
      return false;
    if (requires.providerBlocklist && requires.providerBlocklist.includes(c.provider)) return false;
    return true;
  });
}

export interface PickResult {
  /** The top pick. null if no candidate passed the filters. */
  pick: ScoredCandidate | null;
  /** Ranked alternatives (top N by valueScore). Includes `pick` at [0]. */
  candidates: ScoredCandidate[];
  /** Candidates that were filtered before scoring (with reason).
   *  Useful for the operator dashboard. */
  filtered: { slug: string; reason: string }[];
}

/**
 * The intelligent picker. Filters by hard requirements, scores by
 * value-per-dollar against the task profile, returns ranked candidates.
 *
 * Use this in the architect path (when assembling a new agent), in
 * pickModelForTask (per-task fork — Phase 40 integration), and in any
 * future operator-facing model-recommendation flow.
 */
export function pickBestModel(
  catalog: readonly ModelCatalogEntry[],
  profile: TaskProfile,
  options: PickBestModelOptions = {},
): PickResult {
  const baseline = options.baselineCostIndex ?? DEFAULT_BASELINE;
  const topN = options.topN ?? 5;

  // Pre-filter — track what we dropped and why.
  const filtered: { slug: string; reason: string }[] = [];
  const eligible: ModelCatalogEntry[] = [];

  for (const c of catalog) {
    if (!c.enabled) {
      filtered.push({ slug: c.slug, reason: "disabled" });
      continue;
    }
    if (c.status === "deprecated") {
      filtered.push({ slug: c.slug, reason: "deprecated" });
      continue;
    }
    if ((options.excludeTCritical ?? true) && c.tierAffinity === "T-critical") {
      filtered.push({ slug: c.slug, reason: "T-critical excluded (safety floor)" });
      continue;
    }
    const r = profile.requires ?? {};
    if (r.tools && !c.supportsTools) {
      filtered.push({ slug: c.slug, reason: "tools required" });
      continue;
    }
    if (r.vision && !c.supportsVision) {
      filtered.push({ slug: c.slug, reason: "vision required" });
      continue;
    }
    if (r.reasoning && !c.supportsReasoning) {
      filtered.push({ slug: c.slug, reason: "reasoning required" });
      continue;
    }
    if (r.streaming && !c.supportsStreaming) {
      filtered.push({ slug: c.slug, reason: "streaming required" });
      continue;
    }
    if (r.minContextTokens && c.contextWindowTokens < r.minContextTokens) {
      filtered.push({
        slug: c.slug,
        reason: `context ${c.contextWindowTokens} < required ${r.minContextTokens}`,
      });
      continue;
    }
    if (r.minOutputTokens && c.maxOutputTokens < r.minOutputTokens) {
      filtered.push({
        slug: c.slug,
        reason: `max output ${c.maxOutputTokens} < required ${r.minOutputTokens}`,
      });
      continue;
    }
    if (
      r.providerAllowlist &&
      r.providerAllowlist.length > 0 &&
      !r.providerAllowlist.includes(c.provider)
    ) {
      filtered.push({ slug: c.slug, reason: `provider ${c.provider} not in allowlist` });
      continue;
    }
    if (r.providerBlocklist && r.providerBlocklist.includes(c.provider)) {
      filtered.push({ slug: c.slug, reason: `provider ${c.provider} blocked` });
      continue;
    }
    eligible.push(c);
  }

  // Score every eligible candidate.
  const scored = eligible.map((c) => scoreCandidate(c, profile, baseline));

  // Soft floors (capability + cost).
  const qFloor = profile.qualityFloor ?? 0;
  const costCap = profile.maxCostIndex;
  const filteredAfterScoring = scored.filter((s) => {
    if (s.capabilityMatchScore < qFloor) {
      filtered.push({
        slug: s.slug,
        reason: `capability ${s.capabilityMatchScore.toFixed(1)} < floor ${qFloor}`,
      });
      return false;
    }
    if (costCap !== undefined && s.costIndex > costCap) {
      filtered.push({
        slug: s.slug,
        reason: `cost $${s.costIndex.toFixed(2)}/M > cap $${costCap.toFixed(2)}`,
      });
      return false;
    }
    return true;
  });

  filteredAfterScoring.sort((a, b) => b.valueScore - a.valueScore);
  const topPicks = filteredAfterScoring.slice(0, topN);
  return {
    pick: topPicks[0] ?? null,
    candidates: topPicks,
    filtered,
  };
}
