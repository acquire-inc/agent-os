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

/**
 * Phase 32: per-task model affinity. When an agent invokes a specific
 * skill or tool that has a preferred_model_tier set, the router can fork
 * the dispatch to a different (better-suited) model for that sub-task.
 *
 * The same safety floors apply:
 *   1. T-critical agents are EXEMPT — they always run on the T-critical
 *      pin regardless of any per-task preference. This is the same
 *      "Tier wins, override loses" non-negotiable that protects can't-fail
 *      agents from tenant-level overrides.
 *   2. The original resolution still happens via resolveModel; this
 *      function is a layered re-resolve on top.
 *
 * If `taskPreferredTier` is null/undefined, the function returns the
 * baseline resolution unchanged (no fork). Otherwise it re-runs the
 * tier-resolution path against the new tier — including tenant
 * tier_overrides and DEFAULT_TIER_MODELS — and returns the resulting model.
 *
 * Callers (the runner at skill/tool dispatch time) emit a model.routed
 * Relay event with the fork reason so the audit trail captures every
 * model swap mid-run.
 */
export interface PickModelForTaskArgs extends ResolveModelArgs {
  /** The preferred tier for this sub-task (from skills.preferred_model_tier
   *  or tools.preferred_model_tier). NULL = no preference; baseline wins. */
  taskPreferredTier?: ModelTier | null;
  /** Descriptive label for the sub-task (skill key, tool key, or free-form).
   *  Used in the reason string for the audit trail. */
  taskLabel?: string;
}

export function pickModelForTask(args: PickModelForTaskArgs): ResolveModelResult {
  // Baseline resolution (the agent's normal model).
  const baseline = resolveModel(args);

  // Safety floor: T-critical agents do NOT fork. Even if a skill or tool
  // requests a preference, the can't-fail floor stays at Opus.
  if (args.isCantFail) {
    return baseline;
  }

  // No preference declared: baseline wins.
  if (!args.taskPreferredTier) {
    return baseline;
  }

  // Same tier already: no fork needed.
  if (args.taskPreferredTier === baseline.tier) {
    return baseline;
  }

  // Re-resolve at the new tier. Reuse the same precedence (tenant
  // overrides, then DEFAULT_TIER_MODELS) but skip the spec.model branch —
  // a per-task preference should override the eval-promotion pin only when
  // the operator explicitly opted in via the skill/tool registry.
  const tier = args.taskPreferredTier;
  if (!isModelTier(tier)) {
    throw new TierResolutionError(
      `pickModelForTask: invalid taskPreferredTier="${tier}" — must be one of T-trivial|T-cheap|T-reason|T-work|T-critical`,
    );
  }
  // Refuse a fork TO T-critical from a non-T-critical agent — that would
  // bypass the safety perimeter (non-can't-fail agent running on the
  // can't-fail pin is suspicious and the assertCantFailModel runtime guard
  // would fail-close the run anyway).
  if (tier === "T-critical") {
    throw new TierResolutionError(
      `pickModelForTask: non-T-critical agent ${args.agentKey} cannot fork to T-critical for task ${args.taskLabel ?? "<unlabeled>"} — Opus pin is reserved for can't-fail agents`,
    );
  }

  const overrides = args.tenantOverrides ?? {};
  const tenantPick = overrides[tier];
  const taskLabel = args.taskLabel ?? "task";
  if (tenantPick) {
    return {
      model: tenantPick,
      tier,
      reason: `task-fork: ${baseline.tier} → ${tier} for ${taskLabel} (tenant tier_overrides[${tier}] = ${tenantPick})`,
    };
  }
  const def = DEFAULT_TIER_MODELS[tier];
  return {
    model: def.primary,
    tier,
    reason: `task-fork: ${baseline.tier} → ${tier} for ${taskLabel} (DEFAULT_TIER_MODELS[${tier}].primary)`,
  };
}
