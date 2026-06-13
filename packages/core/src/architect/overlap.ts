// Architect overlap detector (B3).
//
// When the Architect proposes a fleet, it can synthesize two agents whose
// responsibilities overlap on the same resource type. At runtime, the lease
// arbitration layer (I-003) will sequence them — but it's better to surface
// the overlap at blueprint review so the operator can either confirm it's
// intentional (two distinct verbs on the same target is fine) or have the
// Architect redraw the team.
//
// Heuristic — pure, no LLM call. Two agents in the same blueprint overlap
// when they share BOTH:
//   - the same connector (mcpName), AND
//   - the same skill key.
//
// Reasoning: (connector, skill) is the closest stable signal we have for
// "these two agents will reach for the same tool against the same backend."
// It produces false positives only when the two agents do meaningfully
// different things with the same skill on the same connector — that's the
// case the operator confirms and dismisses. It rarely produces false
// negatives at this granularity.
//
// Returns one warning per pair, with both agent keys and the shared
// (connector, skill) intersection. Empty array when nothing overlaps.

export interface AgentForOverlap {
  key: string;
  skillKeys: readonly string[];
  mcpNames: readonly string[];
}

export interface OverlapWarning {
  pair: [string, string];
  sharedConnectors: string[];
  sharedSkills: string[];
  /** Human-readable string for HydratedBlueprint.warnings emission. */
  message: string;
}

export function detectArchitectOverlap(agents: readonly AgentForOverlap[]): OverlapWarning[] {
  const warnings: OverlapWarning[] = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!;
      const b = agents[j]!;
      const sharedConnectors = a.mcpNames.filter((n) => b.mcpNames.includes(n));
      if (sharedConnectors.length === 0) continue;
      const sharedSkills = a.skillKeys.filter((k) => b.skillKeys.includes(k));
      if (sharedSkills.length === 0) continue;
      warnings.push({
        pair: [a.key, b.key],
        sharedConnectors: [...sharedConnectors],
        sharedSkills: [...sharedSkills],
        message:
          `overlap: ${a.key} and ${b.key} share connector(s) ${sharedConnectors.join(", ")} ` +
          `and skill(s) ${sharedSkills.join(", ")}. Confirm the verbs they apply differ, ` +
          `or have the architect re-draw the team (see docs/agent-coordination-guidelines.md).`,
      });
    }
  }
  return warnings;
}
