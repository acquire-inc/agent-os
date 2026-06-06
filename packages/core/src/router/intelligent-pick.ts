// Phase 40: intelligent per-task model selection.
//
// Higher-level API that combines:
//   - The model catalog (Phase 38, supabase 0020)
//   - The pickBestModel scorer (Phase 39, intelligence.ts)
//   - The existing per-task fork (Phase 32, resolve.pickModelForTask)
//
// Two layered paths the runner can take when a skill/tool wants to
// fork the model mid-run:
//
//   1. taskProfile present -> intelligent picker scores the catalog
//      against the profile; returns ranked candidates with rationale.
//   2. taskProfile absent but preferred_model_tier present -> tier-based
//      fork via pickModelForTask (Phase 32 path).
//   3. Neither -> baseline agent model.
//
// Safety floors are preserved at every layer:
//   - T-critical agents always run their pinned Opus regardless
//   - Non-T-critical agents CANNOT fork TO T-critical
//   - Disabled / deprecated catalog rows are pre-filtered
//
// This module does NOT touch the SDK session; it returns the resolved
// slug + rationale + audit metadata. The runner emits model.routed
// Relay events with this output so the audit trail captures every
// intelligent pick.

import { isCantFail } from "../architect/hydrate.js";
import {
  pickBestModel,
  type ModelCatalogEntry,
  type PickResult,
  type TaskProfile,
} from "./intelligence.js";
import { pickModelForTask, type ResolveModelResult } from "./resolve.js";
import type { ModelTier } from "./tier-models.js";

export interface IntelligentPickArgs {
  /** Agent baseline — same shape as pickModelForTask inputs. */
  agentKey: string;
  agentModel: string;
  agentTier: ModelTier;
  agentTenantOverrides?: Record<string, string> | null;
  /** The skill / tool that's triggering the fork (for the audit label). */
  taskLabel: string;
  /** TaskProfile JSON from skills.task_profile or tools.task_profile.
   *  Empty {} or undefined = falls back to tier-based fork. */
  taskProfile?: Record<string, unknown> | null;
  /** Tier hint (skills.preferred_model_tier or tools.preferred_model_tier).
   *  Used when taskProfile is absent. */
  taskPreferredTier?: ModelTier | null;
  /** Live catalog rows (from the models table). The caller fetches
   *  these once per run and passes them in. */
  catalog: readonly ModelCatalogEntry[];
}

export interface IntelligentPickResult {
  /** Resolved model slug to use for this task. */
  model: string;
  /** Where the pick came from: which fork path won. */
  source: "catalog_picker" | "tier_fork" | "agent_baseline";
  /** Tier label for the audit trail. */
  tier: ModelTier;
  /** Human-readable rationale (audit + dashboard display). */
  reason: string;
  /** When source=catalog_picker, the full ranked alternatives.
   *  When source=tier_fork or baseline, this is empty. */
  alternatives: PickResult["candidates"];
  /** When source=catalog_picker, candidates that were filtered + why. */
  filtered: PickResult["filtered"];
}

function isTaskProfile(p: unknown): p is TaskProfile {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return "capabilities" in obj && typeof obj.capabilities === "object";
}

/**
 * Decide which model to dispatch on for a specific sub-task.
 *
 * Path 1 — taskProfile present and non-empty:
 *   Run pickBestModel against the live catalog. Return the top pick
 *   with full alternatives + filtered metadata for the audit trail.
 *
 * Path 2 — no taskProfile but a preferred_model_tier:
 *   Tier-based fork via pickModelForTask (Phase 32).
 *
 * Path 3 — neither:
 *   The agent's baseline model with source="agent_baseline".
 *
 * T-critical safety floor wins over all three paths.
 */
export function pickModelIntelligently(args: IntelligentPickArgs): IntelligentPickResult {
  // Safety floor: T-critical agents never fork.
  if (isCantFail(args.agentKey)) {
    return {
      model: args.agentModel,
      source: "agent_baseline",
      tier: "T-critical",
      reason: `T-critical agent ${args.agentKey} — no fork; pinned to ${args.agentModel}`,
      alternatives: [],
      filtered: [],
    };
  }

  // Path 1: intelligent picker with TaskProfile.
  if (isTaskProfile(args.taskProfile)) {
    const profile = args.taskProfile as TaskProfile;
    // Only run the picker if at least one capability weight is non-zero.
    const totalWeight = Object.values(profile.capabilities ?? {}).reduce(
      (s, w) => s + ((w as number) ?? 0),
      0,
    );
    if (totalWeight > 0) {
      const result = pickBestModel(args.catalog, profile);
      if (result.pick) {
        // WR-13 fix: defense in depth — if a future caller opts to set
        // excludeTCritical: false and the picker selects a T-critical
        // model for a non-cantfail agent, refuse the fork and fall
        // through to baseline. Mirrors the perimeter protection in
        // pickModelForTask.
        const pickedTier = pickTierFromCatalog(args.catalog, result.pick.slug);
        if (pickedTier === "T-critical") {
          return {
            model: args.agentModel,
            source: "agent_baseline",
            tier: args.agentTier,
            reason: `intelligent picker selected T-critical slug ${result.pick.slug} for non-cantfail agent ${args.agentKey} — refused (perimeter protection)`,
            alternatives: [],
            filtered: result.filtered,
          };
        }
        return {
          model: result.pick.slug,
          source: "catalog_picker",
          tier: pickedTier ?? args.agentTier,
          reason: `intelligent pick for ${args.taskLabel}: ${result.pick.rationale}`,
          alternatives: result.candidates,
          filtered: result.filtered,
        };
      }
      // Picker ran but had no winner (all filtered) — fall through to baseline.
    }
  }

  // Path 2: tier-based fork (Phase 32).
  if (args.taskPreferredTier) {
    try {
      const fork = pickModelForTask({
        agentKey: args.agentKey,
        isCantFail: false,
        modelTier: args.agentTier,
        specModel: null,
        tenantOverrides: args.agentTenantOverrides,
        taskPreferredTier: args.taskPreferredTier,
        taskLabel: args.taskLabel,
      });
      return {
        model: fork.model,
        source: "tier_fork",
        tier: fork.tier,
        reason: fork.reason,
        alternatives: [],
        filtered: [],
      };
    } catch (e) {
      // pickModelForTask refused (e.g. perimeter protection) — fall through
      // to baseline with the error in the rationale.
      return {
        model: args.agentModel,
        source: "agent_baseline",
        tier: args.agentTier,
        reason: `tier fork refused for ${args.taskLabel}: ${(e as Error).message}; falling back to ${args.agentModel}`,
        alternatives: [],
        filtered: [],
      };
    }
  }

  // Path 3: baseline.
  return {
    model: args.agentModel,
    source: "agent_baseline",
    tier: args.agentTier,
    reason: `${args.taskLabel}: no task_profile or preferred_model_tier; using agent baseline ${args.agentModel}`,
    alternatives: [],
    filtered: [],
  };
}

function pickTierFromCatalog(catalog: readonly ModelCatalogEntry[], slug: string): ModelTier | null {
  const entry = catalog.find((c) => c.slug === slug);
  return entry?.tierAffinity ?? null;
}
