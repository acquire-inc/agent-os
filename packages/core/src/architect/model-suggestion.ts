// Phase 54: architect-side model suggestion.
//
// When the architect's LLM emits a TeamBlueprintProposal, walk each
// blueprint's intended skills, compose a TaskProfile from their
// task_profile JSON, run pickBestModel against the live catalog, and
// suggest the optimal starting model. Operators see this in the
// blueprint preview UI and can accept the suggestion or stick with the
// LLM-emitted model.
//
// Pure module. Takes a "skill registry lookup" function so the caller
// (the architect endpoint) can fetch task_profiles however it likes
// (db query, in-memory cache, etc.).
//
// Safety alignment:
//   - T-critical agents bypass this entirely (they pin to Opus via
//     CANT_FAIL_KEYS — the architect's hydrate.ts refuses to assemble
//     them at all, so they shouldn't reach this code)
//   - Non-T-critical agents go through pickBestModel with
//     excludeTCritical: true; non-T-critical can't be suggested to
//     T-critical slugs (perimeter protection via Phase 39 default)

import { isCantFail } from "./hydrate.js";
import type { ModelCatalogEntry, ScoredCandidate, TaskProfile } from "../router/intelligence.js";
import { pickBestModel } from "../router/intelligence.js";
import type { AgentBlueprint } from "./types.js";

export interface SkillRegistry {
  /** Look up the task_profile JSON for a skill key. Returns null when
   *  the skill doesn't exist or has no profile. */
  getTaskProfile: (skillKey: string) => TaskProfile | null;
}

export interface ModelSuggestion {
  /** The suggested model slug (highest-value pick). */
  recommendedModel: string;
  /** Composite TaskProfile we ran the picker against. */
  compositeProfile: TaskProfile;
  /** Top-N alternatives + scoring breakdown for the operator review UI. */
  alternatives: ScoredCandidate[];
  /** Why this model was picked (rationale). */
  rationale: string;
  /** When the blueprint already specified a model (LLM intent), the
   *  caller may want to skip the suggestion. This field surfaces both. */
  llmEmittedModel: string | null;
}

/**
 * Compose a TaskProfile by unioning capability weights from N skills.
 * Each skill's weights are normalized first (so a skill with three
 * weights summing to 3 contributes the same total as a skill with one
 * weight of 1). Then they're summed.
 */
export function composeTaskProfileFromSkills(
  skillKeys: readonly string[],
  registry: SkillRegistry,
): TaskProfile {
  const acc: Partial<Record<string, number>> = {};
  let costSensitivities: ("low" | "medium" | "high")[] = [];
  let qualityFloors: number[] = [];
  const requires: NonNullable<TaskProfile["requires"]> = {};

  for (const skillKey of skillKeys) {
    const profile = registry.getTaskProfile(skillKey);
    if (!profile || !profile.capabilities) continue;

    const total = Object.values(profile.capabilities).reduce(
      (s, w) => s + (w ?? 0),
      0,
    );
    if (total === 0) continue;

    for (const [cap, weight] of Object.entries(profile.capabilities)) {
      const normalized = (weight ?? 0) / total;
      acc[cap] = (acc[cap] ?? 0) + normalized;
    }
    if (profile.costSensitivity) costSensitivities.push(profile.costSensitivity);
    if (profile.qualityFloor) qualityFloors.push(profile.qualityFloor);

    // Merge hard requirements (most restrictive wins).
    if (profile.requires) {
      if (profile.requires.tools) requires.tools = true;
      if (profile.requires.vision) requires.vision = true;
      if (profile.requires.reasoning) requires.reasoning = true;
      if (profile.requires.streaming) requires.streaming = true;
      if (profile.requires.minContextTokens) {
        requires.minContextTokens = Math.max(
          requires.minContextTokens ?? 0,
          profile.requires.minContextTokens,
        );
      }
      if (profile.requires.minOutputTokens) {
        requires.minOutputTokens = Math.max(
          requires.minOutputTokens ?? 0,
          profile.requires.minOutputTokens,
        );
      }
    }
  }

  // Pick the most cautious cost sensitivity (low > medium > high quality-wise).
  // When mixed, default to "medium" — a reasonable blend.
  const costSensitivity = costSensitivities.length === 0
    ? "medium"
    : costSensitivities.includes("low")
      ? "low"
      : costSensitivities.includes("medium")
        ? "medium"
        : "high";

  // Pick the highest qualityFloor (most cautious).
  const qualityFloor = qualityFloors.length > 0 ? Math.max(...qualityFloors) : undefined;

  const profile: TaskProfile = {
    capabilities: acc as Partial<Record<import("../router/intelligence.js").CapabilityKey, number>>,
    costSensitivity,
  };
  if (qualityFloor !== undefined) profile.qualityFloor = qualityFloor;
  if (Object.keys(requires).length > 0) profile.requires = requires;
  return profile;
}

/**
 * Suggest the optimal model for an agent blueprint based on its skills'
 * task profiles. Returns null when the agent is on the can't-fail list
 * (those are doctrine-pinned) or when no skills resolve to a profile.
 */
export function suggestModelForBlueprint(
  blueprint: AgentBlueprint,
  catalog: readonly ModelCatalogEntry[],
  registry: SkillRegistry,
): ModelSuggestion | null {
  // Can't-fail agents: don't suggest. The architect's hydrate.ts already
  // refuses to assemble them; this is defense in depth.
  if (isCantFail(blueprint.key)) return null;

  const compositeProfile = composeTaskProfileFromSkills(blueprint.skillKeys, registry);

  // No usable profile (no skills with task_profile): no suggestion.
  const totalWeight = Object.values(compositeProfile.capabilities).reduce(
    (s, w) => s + (w ?? 0),
    0,
  );
  if (totalWeight === 0) return null;

  const result = pickBestModel(catalog, compositeProfile, { topN: 5 });
  if (!result.pick) return null;

  return {
    recommendedModel: result.pick.slug,
    compositeProfile,
    alternatives: result.candidates,
    rationale: `Composed profile from ${blueprint.skillKeys.length} skills; picker selected ${result.pick.slug}: ${result.pick.rationale}`,
    llmEmittedModel: blueprint.model && blueprint.model.length > 0 ? blueprint.model : null,
  };
}
