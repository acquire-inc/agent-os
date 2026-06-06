// Phase 54 tests: architect-side model suggestion.
// Run: pnpm --filter @agent-os/core test:model-suggestion

import { composeTaskProfileFromSkills, suggestModelForBlueprint, type SkillRegistry } from "./model-suggestion.js";
import type { ModelCatalogEntry } from "../router/intelligence.js";
import type { AgentBlueprint } from "./types.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const REGISTRY: SkillRegistry = {
  getTaskProfile(key) {
    switch (key) {
      case "briefing-synthesis":
        return {
          capabilities: { reasoning: 1, summarization: 0.8, long_context: 0.6, factuality: 0.8 },
          costSensitivity: "medium",
          qualityFloor: 7,
        };
      case "morning-vitals":
        return {
          capabilities: { classification: 1, tool_use: 0.5 },
          costSensitivity: "high",
        };
      case "creative-generation":
        return {
          capabilities: { code_generation: 1, reasoning: 0.6, tool_use: 0.4 },
          costSensitivity: "medium",
        };
      case "no-profile-skill":
        return null;
      default:
        return null;
    }
  },
};

const CATALOG: readonly ModelCatalogEntry[] = [
  {
    slug: "anthropic/claude-opus-4.8",
    provider: "anthropic", family: "claude-opus", status: "preferred",
    costInputPerMillionUsd: 15, costOutputPerMillionUsd: 75,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: true, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 10, tool_use: 10, summarization: 10, classification: 9 },
    tierAffinity: "T-critical", enabled: true,
  },
  {
    slug: "anthropic/claude-sonnet-4.6",
    provider: "anthropic", family: "claude-sonnet", status: "preferred",
    costInputPerMillionUsd: 3, costOutputPerMillionUsd: 15,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: true, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 9, tool_use: 10, summarization: 9, classification: 9 },
    tierAffinity: "T-work", enabled: true,
  },
  {
    slug: "nousresearch/hermes-4-70b",
    provider: "nousresearch", family: "hermes", status: "preferred",
    costInputPerMillionUsd: 0.4, costOutputPerMillionUsd: 1.2,
    contextWindowTokens: 128000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: false, supportsStreaming: true,
    capabilityScores: { reasoning: 7, classification: 8, summarization: 8 },
    tierAffinity: "T-cheap", enabled: true,
  },
];

function blueprint(opts: Partial<AgentBlueprint> & { key: string; skillKeys: string[] }): AgentBlueprint {
  return {
    key: opts.key,
    name: opts.name ?? "Test Agent",
    role: opts.role ?? "Test role",
    systemPrompt: opts.systemPrompt ?? "You are a test agent.",
    model: opts.model ?? "",
    autonomy: opts.autonomy ?? "propose",
    knowledgeScope: opts.knowledgeScope ?? { folders: [], tags: [] },
    budgetCapUsd: opts.budgetCapUsd ?? "0.50",
    cron: opts.cron ?? null,
    skillKeys: opts.skillKeys,
    mcpNames: opts.mcpNames ?? [],
  };
}

async function main() {
  console.log("• Group 1 — single-skill composition");
  {
    const profile = composeTaskProfileFromSkills(["briefing-synthesis"], REGISTRY);
    assert(profile.capabilities.reasoning !== undefined, "reasoning weight present");
    assert(profile.costSensitivity === "medium", "costSensitivity = medium");
    assert(profile.qualityFloor === 7, "qualityFloor = 7");
  }

  console.log("\n• Group 2 — multi-skill composition unions weights + picks most cautious sensitivity");
  {
    const profile = composeTaskProfileFromSkills(["briefing-synthesis", "creative-generation"], REGISTRY);
    // briefing-synthesis: reasoning, summarization, long_context, factuality
    // creative-generation: code_generation, reasoning, tool_use
    // Composite has all these capabilities.
    assert(profile.capabilities.reasoning !== undefined, "reasoning blended");
    assert(profile.capabilities.code_generation !== undefined, "code_generation from generation");
    assert(profile.capabilities.summarization !== undefined, "summarization from briefing");
    // Both are medium sensitivity -> result is medium.
    assert(profile.costSensitivity === "medium", "costSensitivity stays medium");
  }

  console.log("\n• Group 3 — mixed sensitivities pick low (most quality-favoring)");
  {
    const REG_LOW: SkillRegistry = {
      getTaskProfile(key) {
        if (key === "low-skill") return { capabilities: { reasoning: 1 }, costSensitivity: "low", qualityFloor: 9 };
        if (key === "high-skill") return { capabilities: { classification: 1 }, costSensitivity: "high" };
        return null;
      },
    };
    const profile = composeTaskProfileFromSkills(["low-skill", "high-skill"], REG_LOW);
    assert(profile.costSensitivity === "low", "low wins over high");
    assert(profile.qualityFloor === 9, "qualityFloor = 9 (most cautious)");
  }

  console.log("\n• Group 4 — skill with no profile is skipped silently");
  {
    const profile = composeTaskProfileFromSkills(["briefing-synthesis", "no-profile-skill", "unknown-skill"], REGISTRY);
    assert(profile.capabilities.reasoning !== undefined, "briefing-synthesis still contributes");
    // costSensitivity should be medium (only briefing-synthesis contributed).
    assert(profile.costSensitivity === "medium", "costSensitivity = medium");
  }

  console.log("\n• Group 5 — suggestModelForBlueprint returns a valid pick");
  {
    const bp = blueprint({ key: "reporting-agent", skillKeys: ["briefing-synthesis"] });
    const suggestion = suggestModelForBlueprint(bp, CATALOG, REGISTRY);
    assert(suggestion !== null, "suggestion produced");
    assert(suggestion!.recommendedModel.length > 0, "recommendedModel populated");
    assert(suggestion!.recommendedModel !== "anthropic/claude-opus-4.8", "T-critical opus excluded by default");
    assert(suggestion!.alternatives.length > 0, "alternatives surfaced");
    assert(suggestion!.rationale.includes("Composed profile"), "rationale names composition");
    assert(suggestion!.llmEmittedModel === null, "no LLM-emitted model");
  }

  console.log("\n• Group 6 — agent on CANT_FAIL_KEYS gets null suggestion");
  {
    // tenant-isolation-tester is in CANT_FAIL_KEYS per hydrate.ts
    const bp = blueprint({ key: "tenant-isolation-tester", skillKeys: ["briefing-synthesis"] });
    const suggestion = suggestModelForBlueprint(bp, CATALOG, REGISTRY);
    assert(suggestion === null, "can't-fail agent gets null suggestion (doctrine-pinned)");
  }

  console.log("\n• Group 7 — blueprint with no usable skills gets null suggestion");
  {
    const bp = blueprint({ key: "empty-agent", skillKeys: ["no-profile-skill"] });
    const suggestion = suggestModelForBlueprint(bp, CATALOG, REGISTRY);
    assert(suggestion === null, "no resolvable profile -> null");
  }

  console.log("\n• Group 8 — llmEmittedModel echoes the blueprint's model field");
  {
    const bp = blueprint({
      key: "reporting-agent",
      skillKeys: ["briefing-synthesis"],
      model: "anthropic/claude-sonnet-4.6",
    });
    const suggestion = suggestModelForBlueprint(bp, CATALOG, REGISTRY);
    assert(suggestion!.llmEmittedModel === "anthropic/claude-sonnet-4.6", "llmEmittedModel echoes blueprint.model");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
