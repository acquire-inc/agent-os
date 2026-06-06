// Phase 46: pre-run cost forecasting.
//
// Pure function: given a model catalog entry and token estimates, return
// the projected USD cost of a run. The chat workspace shows this to the
// operator BEFORE dispatch so they can see "this Sonnet pick will cost
// ~$0.04; the cheap-alternative pick costs $0.003 — proceed?"
//
// Two layers:
//   - forecastRunCost(model, tokens) -> { usd, breakdown } for one model
//   - compareForecasts(catalog, tokens, profile?) -> ranked candidates by
//     cost for the same expected token mix, with the picker's rationale
//     merged in. Useful for "show me everything that would handle this
//     task and their costs."

import type { ModelCatalogEntry, ScoredCandidate, TaskProfile } from "./intelligence.js";
import { pickBestModel } from "./intelligence.js";

export interface TokenEstimate {
  /** Expected input tokens (prompt + system + tools + retrieved knowledge). */
  inputTokens: number;
  /** Expected output tokens (model generation). */
  outputTokens: number;
}

export interface CostForecast {
  modelSlug: string;
  inputCostUsd: number;
  outputCostUsd: number;
  totalUsd: number;
  /** Per-1M-token unit costs for the operator's reference. */
  costPerMillionInputUsd: number;
  costPerMillionOutputUsd: number;
}

export function forecastRunCost(
  model: ModelCatalogEntry,
  tokens: TokenEstimate,
): CostForecast {
  const inputCostUsd = (tokens.inputTokens / 1_000_000) * model.costInputPerMillionUsd;
  const outputCostUsd = (tokens.outputTokens / 1_000_000) * model.costOutputPerMillionUsd;
  return {
    modelSlug: model.slug,
    inputCostUsd,
    outputCostUsd,
    totalUsd: inputCostUsd + outputCostUsd,
    costPerMillionInputUsd: model.costInputPerMillionUsd,
    costPerMillionOutputUsd: model.costOutputPerMillionUsd,
  };
}

export interface CandidateForecast {
  candidate: ScoredCandidate;
  forecast: CostForecast;
  /** When the operator sets the budget cap, this flags whether the
   *  candidate fits. NULL when no cap was supplied. */
  withinBudget: boolean | null;
}

export interface CompareForecastsArgs {
  catalog: readonly ModelCatalogEntry[];
  tokens: TokenEstimate;
  /** When provided, the picker scores the catalog against the profile
   *  and we merge ranked candidates with their forecasts. */
  profile?: TaskProfile;
  /** When provided, each candidate is tagged withinBudget = totalUsd <= cap. */
  budgetCapUsd?: number;
}

export interface CompareForecastsResult {
  /** Forecasts sorted by valueScore desc when profile is supplied,
   *  else sorted by totalUsd asc (cheapest first). */
  candidates: CandidateForecast[];
  /** When a profile and a budgetCap are both set: the cheapest candidate
   *  that fits the budget AND clears any qualityFloor. */
  recommended: CandidateForecast | null;
}

export function compareForecasts(args: CompareForecastsArgs): CompareForecastsResult {
  const cap = args.budgetCapUsd;
  if (args.profile) {
    const result = pickBestModel(args.catalog, args.profile, { topN: args.catalog.length });
    const candidates: CandidateForecast[] = result.candidates.map((c) => {
      const model = args.catalog.find((m) => m.slug === c.slug);
      const forecast = model
        ? forecastRunCost(model, args.tokens)
        : { modelSlug: c.slug, inputCostUsd: 0, outputCostUsd: 0, totalUsd: 0, costPerMillionInputUsd: 0, costPerMillionOutputUsd: 0 };
      return {
        candidate: c,
        forecast,
        withinBudget: cap !== undefined ? forecast.totalUsd <= cap : null,
      };
    });
    // Recommended = highest-value pick that fits the budget. WR-01 fix:
    // when a cap was supplied and NOTHING fits, return null — don't
    // recommend a candidate that violates withinBudget. The caller can
    // present the cheapest in-budget option or explain the gap.
    if (cap !== undefined) {
      const inBudget = candidates.filter((c) => c.withinBudget === true);
      return {
        candidates,
        recommended: inBudget[0] ?? null,
      };
    }
    return {
      candidates,
      recommended: candidates[0] ?? null,
    };
  }

  // No profile: rank by cheapest first.
  const candidates: CandidateForecast[] = args.catalog
    .filter((m) => m.enabled && m.status !== "deprecated")
    .map((m) => {
      const forecast = forecastRunCost(m, args.tokens);
      return {
        candidate: {
          slug: m.slug,
          provider: m.provider,
          family: m.family,
          capabilityMatchScore: 0,
          costIndex: 0,
          valueScore: 0,
          breakdown: {},
          rationale: `${m.slug}: forecast $${forecast.totalUsd.toFixed(4)} for ${args.tokens.inputTokens}+${args.tokens.outputTokens} tokens`,
        },
        forecast,
        withinBudget: cap !== undefined ? forecast.totalUsd <= cap : null,
      };
    });
  candidates.sort((a, b) => a.forecast.totalUsd - b.forecast.totalUsd);
  return {
    candidates,
    recommended: candidates[0] ?? null,
  };
}
