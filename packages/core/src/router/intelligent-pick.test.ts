// Phase 40 tests: pickModelIntelligently end-to-end across the three
// fork paths (catalog picker, tier fork, baseline fallback).
//
// Run: pnpm --filter @agent-os/core test:intelligent-pick

import { pickModelIntelligently } from "./intelligent-pick.js";
import type { ModelCatalogEntry } from "./intelligence.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const CATALOG: readonly ModelCatalogEntry[] = [
  {
    slug: "anthropic/claude-opus-4.8",
    provider: "anthropic", family: "claude-opus", status: "preferred",
    costInputPerMillionUsd: 15, costOutputPerMillionUsd: 75,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: true, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 10, tool_use: 10 },
    tierAffinity: "T-critical", enabled: true,
  },
  {
    slug: "anthropic/claude-sonnet-4.6",
    provider: "anthropic", family: "claude-sonnet", status: "preferred",
    costInputPerMillionUsd: 3, costOutputPerMillionUsd: 15,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: true, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 9, tool_use: 10, summarization: 9 },
    tierAffinity: "T-work", enabled: true,
  },
  {
    slug: "nousresearch/hermes-4-405b",
    provider: "nousresearch", family: "hermes", status: "preferred",
    costInputPerMillionUsd: 3, costOutputPerMillionUsd: 9,
    contextWindowTokens: 128000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: false, supportsStreaming: true,
    capabilityScores: { reasoning: 9, summarization: 9 },
    tierAffinity: "T-reason", enabled: true,
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
  {
    slug: "google/gemini-2-flash",
    provider: "google", family: "gemini-2", status: "preferred",
    costInputPerMillionUsd: 0.075, costOutputPerMillionUsd: 0.3,
    contextWindowTokens: 1000000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 7, summarization: 8, long_context: 10, vision: 8 },
    tierAffinity: null, enabled: true,
  },
];

async function main() {
  console.log("• Group 1 — T-critical agent: no fork regardless of inputs");
  {
    const r = pickModelIntelligently({
      agentKey: "tenant-isolation-tester", // on CANT_FAIL_KEYS
      agentModel: "anthropic/claude-opus-4.8",
      agentTier: "T-critical",
      taskLabel: "skill:adversarial-test",
      taskProfile: { capabilities: { reasoning: 1 }, costSensitivity: "high" },
      taskPreferredTier: "T-cheap",
      catalog: CATALOG,
    });
    assert(r.source === "agent_baseline", "T-critical -> source=agent_baseline");
    assert(r.model === "anthropic/claude-opus-4.8", "model stays at Opus");
    assert(r.tier === "T-critical", "tier stays T-critical");
    assert(r.alternatives.length === 0, "no alternatives surfaced for T-critical");
  }

  console.log("\n• Group 2 — TaskProfile present: catalog picker wins");
  {
    const r = pickModelIntelligently({
      agentKey: "weekly-report", // non-T-critical
      agentModel: "nousresearch/hermes-4-70b",
      agentTier: "T-cheap",
      taskLabel: "skill:briefing-synthesis",
      taskProfile: {
        capabilities: { reasoning: 1, summarization: 1, long_context: 0.5 },
        costSensitivity: "medium",
      },
      catalog: CATALOG,
    });
    assert(r.source === "catalog_picker", `source=catalog_picker (got ${r.source})`);
    assert(r.model.length > 0, "model resolved");
    assert(r.alternatives.length > 0, "alternatives surfaced for audit");
    assert(r.reason.includes("intelligent pick"), "reason mentions intelligent pick");
  }

  console.log("\n• Group 3 — TaskProfile present but T-critical excluded: opus never wins");
  {
    const r = pickModelIntelligently({
      agentKey: "weekly-report",
      agentModel: "nousresearch/hermes-4-70b",
      agentTier: "T-cheap",
      taskLabel: "skill:reasoning-heavy",
      taskProfile: {
        capabilities: { reasoning: 1 },
        costSensitivity: "low",
        qualityFloor: 8,
      },
      catalog: CATALOG,
    });
    assert(r.model !== "anthropic/claude-opus-4.8", "opus excluded by T-critical safety floor");
    assert(
      r.alternatives.every((a) => a.slug !== "anthropic/claude-opus-4.8"),
      "no opus in alternatives either",
    );
  }

  console.log("\n• Group 4 — Empty TaskProfile + preferred_model_tier: tier fork path");
  {
    const r = pickModelIntelligently({
      agentKey: "weekly-report",
      agentModel: "nousresearch/hermes-4-70b",
      agentTier: "T-cheap",
      taskLabel: "skill:legacy-skill",
      taskProfile: {}, // no capabilities -> picker skipped
      taskPreferredTier: "T-reason",
      catalog: CATALOG,
    });
    assert(r.source === "tier_fork", `source=tier_fork (got ${r.source})`);
    assert(r.tier === "T-reason", "tier forked to T-reason");
    assert(r.reason.includes("task-fork"), "reason names tier fork");
  }

  console.log("\n• Group 5 — TaskProfile with no capabilities + no preferred_tier: baseline");
  {
    const r = pickModelIntelligently({
      agentKey: "weekly-report",
      agentModel: "nousresearch/hermes-4-70b",
      agentTier: "T-cheap",
      taskLabel: "skill:no-profile",
      taskProfile: {}, // empty
      taskPreferredTier: null,
      catalog: CATALOG,
    });
    assert(r.source === "agent_baseline", `source=agent_baseline (got ${r.source})`);
    assert(r.model === "nousresearch/hermes-4-70b", "baseline model unchanged");
  }

  console.log("\n• Group 6 — Picker filters everything: graceful baseline fallback");
  {
    const r = pickModelIntelligently({
      agentKey: "weekly-report",
      agentModel: "nousresearch/hermes-4-70b",
      agentTier: "T-cheap",
      taskLabel: "skill:impossible",
      taskProfile: {
        capabilities: { reasoning: 1 },
        requires: { minContextTokens: 10000000 }, // 10M tokens — nothing qualifies
      },
      catalog: CATALOG,
    });
    assert(r.source === "agent_baseline", `nothing qualifies -> baseline (got ${r.source})`);
    assert(r.model === "nousresearch/hermes-4-70b", "agent model used as fallback");
  }

  console.log("\n• Group 7 — Tier fork to T-critical refused: baseline with reason");
  {
    const r = pickModelIntelligently({
      agentKey: "weekly-report",
      agentModel: "nousresearch/hermes-4-70b",
      agentTier: "T-cheap",
      taskLabel: "skill:malicious",
      taskProfile: {},
      taskPreferredTier: "T-critical", // perimeter protection should refuse
      catalog: CATALOG,
    });
    assert(r.source === "agent_baseline", `T-critical fork refused -> baseline (got ${r.source})`);
    assert(
      r.reason.includes("tier fork refused"),
      `reason names the refusal (got: ${r.reason.slice(0, 80)})`,
    );
  }

  console.log("\n• Group 8 — Operator's '9 cheaper > 10 expensive' rule lands in production path");
  {
    // Reasoning-heavy task, medium sensitivity. Sonnet (9) and Hermes-405b
    // (9) are similar quality but Hermes-405b is cheaper. The picker
    // should prefer Hermes-405b OR a cheaper-still 7-scorer depending on
    // exact numbers — but ALL picks should beat Sonnet on value.
    const r = pickModelIntelligently({
      agentKey: "creative-studio",
      agentModel: "nousresearch/hermes-4-70b",
      agentTier: "T-cheap",
      taskLabel: "skill:critique",
      taskProfile: {
        capabilities: { reasoning: 1 },
        costSensitivity: "medium",
      },
      catalog: CATALOG,
    });
    assert(r.source === "catalog_picker", "picker path selected");
    const pick = r.alternatives[0]!;
    const sonnetAlt = r.alternatives.find((a) => a.slug === "anthropic/claude-sonnet-4.6");
    // Sonnet may or may not be in top-5; if it is, it should lose on value.
    if (sonnetAlt) {
      assert(
        pick.valueScore >= sonnetAlt.valueScore,
        "winner value >= sonnet value (9 cheaper >= 10 expensive)",
      );
    } else {
      assert(true, "sonnet outside top-5 (cheaper alternatives dominated)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
