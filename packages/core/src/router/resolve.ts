// router/resolve.ts — the Model Router resolution function.
//
// Resolves an agent's modelTier + per-tenant overrides into a concrete model
// slug. Called by seedAgent at agent-write time. The runner reads the
// already-resolved agents.model column at SessionStart — no runtime routing
// path, no decision latency. When tier defaults or tenant overrides change,
// the operator runs `pnpm router:resolve-all` to re-resolve every agent's
// row (mechanical re-seed of agents.model).
//
// Precedence (in order):
//   1. T-critical exemption — pinned to Opus, no override, no fallback.
//      Open Q #1 RESOLVED. The runtime cantfail.model_violation assertion
//      is the belt; this is the suspenders.
//   2. spec.model explicit override — per-agent eval-promotion lever.
//      If a doctrine spec or the agent-evaluator has hand-picked a model,
//      that wins.
//   3. tenant.tier_overrides[tier] — per-tenant operator override (the
//      new mechanism replacing the blunt tenants.default_model_override).
//   4. DEFAULT_TIER_MODELS[tier].primary — global doctrine default.

import {
  DEFAULT_TIER_MODELS,
  isModelTier,
  T_CRITICAL_ALLOWLIST,
  type ModelTier,
} from "./tier-models.js";

export interface ResolveModelArgs {
  /** Agent key — used for the T-critical check and the audit reason string. */
  agentKey: string;
  /** Whether this agent is on the CANT_FAIL_KEYS list (caller passes this in
   *  to keep the router free of cross-module deps; seedAgent reads isCantFail). */
  isCantFail: boolean;
  /** Tier intent declared by the spec. Optional for backward compat —
   *  legacy specs without a tier MUST supply specModel. */
  modelTier?: ModelTier | null;
  /** Explicit per-agent model override (spec.model). Wins over tier resolution
   *  on non-T-critical agents (eval-promotion lever). T-critical ignores it. */
  specModel?: string | null;
  /** Per-tenant tier overrides from tenants.tier_overrides jsonb.
   *  Shape: { [tier]: "provider/model-slug" }. */
  tenantOverrides?: Record<string, string> | null;
}

export interface ResolveModelResult {
  /** The resolved model slug to dispatch the agent on. */
  model: string;
  /** The tier the agent ran through (T-critical for can't-fail; whatever
   *  the spec declared otherwise). */
  tier: ModelTier;
  /** Human-readable rationale — appears in the model.routed Relay payload. */
  reason: string;
}

export class TierResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TierResolutionError";
  }
}

export function resolveModel(args: ResolveModelArgs): ResolveModelResult {
  // (1) T-critical exemption. Pinned to the allowlist, no override accepted.
  // The runtime cantfail.model_violation assertion will fail-close any drift,
  // but we enforce here too so the audit trail (agents.model column) never
  // shows a non-Opus value for a can't-fail agent.
  if (args.isCantFail) {
    const opus = DEFAULT_TIER_MODELS["T-critical"].primary;
    return {
      model: opus,
      tier: "T-critical",
      reason: `T-critical exemption: ${args.agentKey} pinned to ${opus} (Open Q #1 RESOLVED)`,
    };
  }

  // (2) Explicit per-agent override. Eval-promotion lever — a doctrine spec
  // or the agent-evaluator can pin a model for a specific agent. Wins over
  // both tier overrides and defaults.
  if (args.specModel) {
    // Tier is informational here; derive from the literal so audits group correctly.
    // (If the spec carries both, modelTier wins for the audit grouping.)
    const tier = args.modelTier ?? "T-work";
    return {
      model: args.specModel,
      tier,
      reason: `explicit spec.model override (eval-promotion or hand-pinned)`,
    };
  }

  // (3 & 4) Tier resolution.
  if (!args.modelTier) {
    throw new TierResolutionError(
      `agent ${args.agentKey} has neither modelTier nor specModel set — the router cannot resolve a fuel`,
    );
  }
  if (!isModelTier(args.modelTier)) {
    throw new TierResolutionError(
      `agent ${args.agentKey} has invalid modelTier="${args.modelTier}" — must be one of T-trivial|T-cheap|T-reason|T-work|T-critical`,
    );
  }

  const tier = args.modelTier;
  const overrides = args.tenantOverrides ?? {};
  const tenantPick = overrides[tier];
  if (tenantPick) {
    // SAFETY: tenant cannot override a T-critical pin. We caught this in step
    // (1) already, but assert here too in case isCantFail was misclassified.
    if (T_CRITICAL_ALLOWLIST.has(DEFAULT_TIER_MODELS[tier].primary) && tier === "T-critical") {
      throw new TierResolutionError(
        `tenant attempted to override T-critical tier to ${tenantPick} for ${args.agentKey} — T-critical is not overridable`,
      );
    }
    return {
      model: tenantPick,
      tier,
      reason: `tenant tier_overrides[${tier}] = ${tenantPick}`,
    };
  }

  const def = DEFAULT_TIER_MODELS[tier];
  return {
    model: def.primary,
    tier,
    reason: `DEFAULT_TIER_MODELS[${tier}].primary`,
  };
}
