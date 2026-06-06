// Phase 51: knowledge-driven TaskProfile inference.
//
// The chat workspace front-end ("type intent → spin up an agent") should
// not have to author a TaskProfile by hand. This module infers one from
// natural-language intent using:
//   1. Canonical category → capability weight mapping (static table)
//   2. Keyword heuristics on the intent string (no LLM needed)
//   3. Optional knowledge-context blend (skill registry signals)
//
// Pure functions. The Phase 51 endpoint composes these — when intent is
// present but profile is not, infer + use.

import type { CapabilityKey, TaskProfile } from "./intelligence.js";

/** Canonical task categories the platform recognizes. Each maps to a
 *  starting TaskProfile.capabilities distribution. Operators tune the
 *  table as the picker accumulates real eval data — Phase 44 feedback
 *  loop and a future Phase 51b can both adjust these. */
export type TaskCategory =
  | "research"
  | "draft"
  | "classify"
  | "summarize"
  | "analyze"
  | "decide"
  | "schedule"
  | "monitor"
  | "communicate"
  | "code"
  | "translate"
  | "extract";

interface CategoryDefaults {
  capabilities: Partial<Record<CapabilityKey, number>>;
  costSensitivity: "low" | "medium" | "high";
  qualityFloor?: number;
}

export const CATEGORY_DEFAULTS: Readonly<Record<TaskCategory, CategoryDefaults>> = {
  research: {
    capabilities: { reasoning: 1, summarization: 0.8, long_context: 0.6, factuality: 0.8 },
    costSensitivity: "medium",
    qualityFloor: 7,
  },
  draft: {
    capabilities: { summarization: 0.8, reasoning: 0.6, tool_use: 0.4 },
    costSensitivity: "medium",
  },
  classify: {
    capabilities: { classification: 1, tool_use: 0.3 },
    costSensitivity: "high",
  },
  summarize: {
    capabilities: { summarization: 1, factuality: 0.5, long_context: 0.5 },
    costSensitivity: "medium",
  },
  analyze: {
    capabilities: { reasoning: 1, factuality: 0.6, summarization: 0.4 },
    costSensitivity: "low",
    qualityFloor: 7,
  },
  decide: {
    capabilities: { reasoning: 1, factuality: 0.7 },
    costSensitivity: "low",
    qualityFloor: 8,
  },
  schedule: {
    capabilities: { tool_use: 1, classification: 0.5 },
    costSensitivity: "high",
  },
  monitor: {
    capabilities: { classification: 1, tool_use: 0.5, latency_sensitivity: 0.6 },
    costSensitivity: "high",
  },
  communicate: {
    capabilities: { summarization: 0.8, multilingual: 0.4, tool_use: 0.5 },
    costSensitivity: "medium",
  },
  code: {
    capabilities: { code_generation: 1, reasoning: 0.6, tool_use: 0.4 },
    costSensitivity: "medium",
    qualityFloor: 7,
  },
  translate: {
    capabilities: { multilingual: 1, summarization: 0.3 },
    costSensitivity: "medium",
  },
  extract: {
    capabilities: { classification: 0.8, factuality: 0.8, long_context: 0.5 },
    costSensitivity: "high",
  },
};

/** Lightweight keyword → category mapping. The first hit wins on
 *  multi-word intents; tune as the chat corpus grows. */
const CATEGORY_KEYWORDS: Readonly<Record<TaskCategory, string[]>> = {
  research: ["research", "investigate", "look into", "find out", "competitor", "market"],
  draft: ["draft", "write", "compose", "create a", "ghost-write"],
  classify: ["classify", "categorize", "tag", "label", "sort"],
  summarize: ["summarize", "summary", "tl;dr", "brief", "recap", "digest"],
  analyze: ["analyze", "analysis", "diagnose", "evaluate", "review"],
  decide: ["decide", "decision", "approve", "recommend", "should we"],
  schedule: ["schedule", "calendar", "book", "remind", "follow up"],
  monitor: ["monitor", "watch", "alert", "track", "detect"],
  communicate: ["email", "message", "reply", "respond", "outreach", "send"],
  code: ["code", "script", "function", "implement", "refactor", "debug"],
  translate: ["translate", "in spanish", "in french", "localize"],
  extract: ["extract", "parse", "find all", "list all", "pull out"],
};

export interface InferenceInputs {
  intent: string;
  /** Optional hints from the front-end (e.g. the user already attached
   *  a screenshot — boost vision weight). */
  hints?: {
    hasImage?: boolean;
    requiresLongDoc?: boolean;
    expectsCode?: boolean;
    requiresTools?: boolean;
  };
}

export interface InferenceResult {
  primaryCategory: TaskCategory;
  secondaryCategories: TaskCategory[];
  profile: TaskProfile;
  /** Human-readable rationale — surfaced in the chat UI. */
  rationale: string;
}

/**
 * Infer the task's primary category from the intent string. Defaults
 * to "analyze" when no keyword matches — a safe middle-ground profile.
 */
export function inferCategoryFromIntent(intent: string): {
  primary: TaskCategory;
  secondary: TaskCategory[];
} {
  const lower = intent.toLowerCase();
  const matches: TaskCategory[] = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [TaskCategory, string[]][]) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matches.push(category);
    }
  }
  if (matches.length === 0) {
    return { primary: "analyze", secondary: [] };
  }
  const [primary, ...secondary] = matches;
  return { primary: primary!, secondary: secondary.slice(0, 2) };
}

/** Compose a TaskProfile from a category, blending in any hints. */
export function categoryToProfile(
  category: TaskCategory,
  hints?: InferenceInputs["hints"],
): TaskProfile {
  const def = CATEGORY_DEFAULTS[category];
  const capabilities: Partial<Record<CapabilityKey, number>> = { ...def.capabilities };
  const requires: NonNullable<TaskProfile["requires"]> = {};

  if (hints?.hasImage) {
    capabilities.vision = Math.max(capabilities.vision ?? 0, 1);
    requires.vision = true;
  }
  if (hints?.requiresLongDoc) {
    capabilities.long_context = Math.max(capabilities.long_context ?? 0, 1);
    requires.minContextTokens = 100000;
  }
  if (hints?.expectsCode) {
    capabilities.code_generation = Math.max(capabilities.code_generation ?? 0, 1);
  }
  if (hints?.requiresTools) {
    requires.tools = true;
    capabilities.tool_use = Math.max(capabilities.tool_use ?? 0, 0.8);
  }

  const profile: TaskProfile = {
    capabilities,
    costSensitivity: def.costSensitivity,
  };
  if (def.qualityFloor) profile.qualityFloor = def.qualityFloor;
  if (Object.keys(requires).length > 0) profile.requires = requires;
  return profile;
}

/** Main entry point. Infer a full TaskProfile from intent + optional hints. */
export function inferTaskProfile(inputs: InferenceInputs): InferenceResult {
  const { primary, secondary } = inferCategoryFromIntent(inputs.intent);
  const profile = categoryToProfile(primary, inputs.hints);

  // Blend secondary categories' capabilities at lower weight.
  for (const sec of secondary) {
    const secProfile = CATEGORY_DEFAULTS[sec];
    for (const [cap, weight] of Object.entries(secProfile.capabilities)) {
      const current = profile.capabilities[cap as CapabilityKey] ?? 0;
      const blended = current + (weight as number) * 0.5;
      profile.capabilities[cap as CapabilityKey] = blended;
    }
  }

  const hintNotes: string[] = [];
  if (inputs.hints?.hasImage) hintNotes.push("vision required");
  if (inputs.hints?.requiresLongDoc) hintNotes.push("100k+ context");
  if (inputs.hints?.expectsCode) hintNotes.push("code generation boost");
  if (inputs.hints?.requiresTools) hintNotes.push("tools required");

  const rationale =
    secondary.length > 0
      ? `intent classified as ${primary} (+ ${secondary.join(", ")} secondary)${hintNotes.length ? "; " + hintNotes.join(", ") : ""}`
      : `intent classified as ${primary}${hintNotes.length ? "; " + hintNotes.join(", ") : ""}`;

  return {
    primaryCategory: primary,
    secondaryCategories: secondary,
    profile,
    rationale,
  };
}
