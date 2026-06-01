// router/tier-models.ts — the canonical default tier → model fuel map.
//
// "Hermes" the operator means is the ROUTER (this module), not a model slug.
// Models are interchangeable fuel; the router picks per task class. Operators
// updating the fleet to a new Hermes (or Claude, DeepSeek, Llama, GPT) edit
// THIS constant + ship a PR. The PR review is the audit gate; the
// agent-evaluator scorecard is the quality gate. No auto-promotion on a
// vendor's release cadence (footgun: new models can regress per-task).
//
// Per-tenant deviation lives in `tenants.tier_overrides jsonb` and is read
// by resolveModel() at seed time. Tenants flip a tier to a different fuel
// without a code change.
//
// T-critical's row is hardcoded to Opus and has an EMPTY fallback chain.
// The runtime cantfail.model_violation assertion (apps/runner/src/execute.ts)
// is the safety floor; this constant is the doctrine surface. Both must
// agree — see resolveModel() for the belt-and-suspenders enforcement.
//
// Pricing references (Jan 2026, OpenRouter quoted, in/out per million tokens):
//   hermes-2-pro-llama-3-8b   ~$0.02 / $0.06     (T-trivial)
//   hermes-4-70b              ~$0.13 / $0.40     (T-cheap)
//   hermes-4-405b             ~$1.00 / $3.00     (T-reason)
//   claude-haiku-4-5          ~$0.80 / $4.00     (T-work light)
//   claude-sonnet-4.6         ~$3.00 / $15.00    (T-work)
//   claude-opus-4.8           ~$15.00 / $75.00   (T-critical)
// 70B → 405B is ~7×; 405B → Sonnet is ~3×; Sonnet → Opus is ~5×.

export const MODEL_TIERS = [
  "T-trivial",
  "T-cheap",
  "T-reason",
  "T-work",
  "T-critical",
] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

const TIER_SET: ReadonlySet<string> = new Set<string>(MODEL_TIERS);
export function isModelTier(s: string): s is ModelTier {
  return TIER_SET.has(s);
}

export interface TierFuel {
  /** The model slug to dispatch when this tier resolves. */
  primary: string;
  /**
   * Ordered fallback chain on rate-limit / model-unavailable errors. EMPTY
   * for T-critical (fail closed — the safety contract requires Opus).
   */
  fallback: readonly string[];
  /** Free-form rationale for the choice; appears in the model.routed Relay payload. */
  notes: string;
}

export const DEFAULT_TIER_MODELS: Record<ModelTier, TierFuel> = {
  "T-trivial": {
    primary: "nousresearch/hermes-2-pro-llama-3-8b",
    fallback: ["nousresearch/hermes-4-70b"],
    notes: "Highest-frequency near-zero-reasoning pings; only used when a 3rd tier earns its complexity beyond 70B.",
  },
  "T-cheap": {
    primary: "nousresearch/hermes-4-70b",
    fallback: ["nousresearch/hermes-2-pro-llama-3-8b"],
    notes: "Volume default — monitors, watchers, triage, single-step tool calls. Always-on fleet.",
  },
  "T-reason": {
    primary: "nousresearch/hermes-4-405b",
    fallback: ["anthropic/claude-sonnet-4.6"],
    notes: "Reasoning workhorse — synthesis, multi-step analysis. Sonnet is the upgrade fallback when 405B reliability slips.",
  },
  "T-work": {
    primary: "anthropic/claude-sonnet-4.6",
    fallback: ["anthropic/claude-haiku-4-5", "nousresearch/hermes-4-405b"],
    notes: "Reliable agentic — multi-step tool orchestration, client-facing content. Haiku is the cheaper sibling; 405B is the cost-saver fallback.",
  },
  "T-critical": {
    primary: "anthropic/claude-opus-4.8",
    // EMPTY by design. T-critical agents must run Opus; if Opus is unavailable,
    // the run fails closed. Anything else would violate Open Q #1 RESOLVED.
    fallback: [],
    notes: "Can't-fail safety — high-stakes judgment. NEVER Hermes. EXEMPT from tenant tier_overrides. Per Open Q #1 (RESOLVED).",
  },
};

/** The single allowlisted T-critical model. The runtime assertion (apps/runner/
 *  src/execute.ts assertCantFailModel) reads this; the resolver pins to it. */
export const T_CRITICAL_ALLOWLIST: ReadonlySet<string> = new Set([
  DEFAULT_TIER_MODELS["T-critical"].primary,
]);

/** Heuristic backfill: derive modelTier from a legacy spec.model literal. Used
 *  by migration 0013 to populate agents.model_tier on existing rows and by
 *  the mechanical seed-script migration. */
export function tierFromLegacyModel(model: string): ModelTier {
  if (model === "anthropic/claude-opus-4.8") return "T-critical";
  if (model === "anthropic/claude-sonnet-4.6") return "T-work";
  if (model === "anthropic/claude-haiku-4-5") return "T-work";
  if (model === "nousresearch/hermes-4-405b") return "T-reason";
  if (model === "nousresearch/hermes-4-70b") return "T-cheap";
  if (model === "nousresearch/hermes-2-pro-llama-3-8b") return "T-trivial";
  // Unknown literal — bias toward T-work as the safest non-critical default.
  return "T-work";
}
