// Phase 39 tests: pickBestModel scoring algorithm.
//
// Asserts the value-per-dollar ranking matches the operator's stated rule
// ("9 cheaper > 10 expensive"), safety floors, and hard-requirement gates.
//
// Run: pnpm --filter @agent-os/core test:intelligence

import {
  filterCandidates,
  pickBestModel,
  scoreCandidate,
  type ModelCatalogEntry,
  type TaskProfile,
} from "./intelligence.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// Test catalog — modeled after migration 0020 seed.
const CATALOG: readonly ModelCatalogEntry[] = [
  {
    slug: "anthropic/claude-opus-4.8",
    provider: "anthropic", family: "claude-opus", status: "preferred",
    costInputPerMillionUsd: 15, costOutputPerMillionUsd: 75,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: true, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 10, tool_use: 10, code_generation: 10, summarization: 10 },
    tierAffinity: "T-critical", enabled: true,
  },
  {
    slug: "anthropic/claude-sonnet-4.6",
    provider: "anthropic", family: "claude-sonnet", status: "preferred",
    costInputPerMillionUsd: 3, costOutputPerMillionUsd: 15,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: true, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 9, tool_use: 10, code_generation: 9, summarization: 9 },
    tierAffinity: "T-work", enabled: true,
  },
  {
    slug: "anthropic/claude-haiku-4-5",
    provider: "anthropic", family: "claude-haiku", status: "preferred",
    costInputPerMillionUsd: 0.8, costOutputPerMillionUsd: 4,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 7, tool_use: 9, code_generation: 7, summarization: 8, latency_sensitivity: 9 },
    tierAffinity: null, enabled: true,
  },
  {
    slug: "nousresearch/hermes-4-405b",
    provider: "nousresearch", family: "hermes", status: "preferred",
    costInputPerMillionUsd: 3, costOutputPerMillionUsd: 9,
    contextWindowTokens: 128000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: false, supportsStreaming: true,
    capabilityScores: { reasoning: 9, tool_use: 7, summarization: 9 },
    tierAffinity: "T-reason", enabled: true,
  },
  {
    slug: "nousresearch/hermes-4-70b",
    provider: "nousresearch", family: "hermes", status: "preferred",
    costInputPerMillionUsd: 0.4, costOutputPerMillionUsd: 1.2,
    contextWindowTokens: 128000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: false, supportsStreaming: true,
    capabilityScores: { reasoning: 7, tool_use: 6, classification: 8, summarization: 8 },
    tierAffinity: "T-cheap", enabled: true,
  },
  {
    slug: "openai/gpt-4o-mini",
    provider: "openai", family: "gpt-4o-mini", status: "preferred",
    costInputPerMillionUsd: 0.15, costOutputPerMillionUsd: 0.6,
    contextWindowTokens: 128000, maxOutputTokens: 16384,
    supportsTools: true, supportsReasoning: false, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 6, tool_use: 8, classification: 8, summarization: 7, latency_sensitivity: 10 },
    tierAffinity: null, enabled: true,
  },
  {
    slug: "google/gemini-2-flash",
    provider: "google", family: "gemini-2", status: "preferred",
    costInputPerMillionUsd: 0.075, costOutputPerMillionUsd: 0.3,
    contextWindowTokens: 1000000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 7, tool_use: 8, summarization: 8, long_context: 10, vision: 8 },
    tierAffinity: null, enabled: true,
  },
  {
    slug: "deprecated/old-model",
    provider: "fake", family: "old", status: "deprecated",
    costInputPerMillionUsd: 100, costOutputPerMillionUsd: 100,
    contextWindowTokens: 4096, maxOutputTokens: 1024,
    supportsTools: false, supportsReasoning: false, supportsVision: false, supportsStreaming: false,
    capabilityScores: { reasoning: 10 }, tierAffinity: null, enabled: true,
  },
  {
    slug: "disabled/internal-model",
    provider: "internal", family: "x", status: "preferred",
    costInputPerMillionUsd: 0, costOutputPerMillionUsd: 0,
    contextWindowTokens: 200000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: true, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 10, tool_use: 10 }, tierAffinity: null, enabled: false,
  },
];

async function main() {
  console.log("• Group 1 — T-critical excluded by default (safety floor)");
  {
    const result = pickBestModel(CATALOG, {
      capabilities: { reasoning: 1 },
    });
    assert(
      !result.candidates.some((c) => c.slug === "anthropic/claude-opus-4.8"),
      "opus-4.8 (T-critical) NOT in candidates by default",
    );
    assert(
      result.filtered.some((f) => f.slug === "anthropic/claude-opus-4.8" && f.reason.includes("T-critical")),
      "opus-4.8 filtered with T-critical reason",
    );
  }

  console.log("\n• Group 2 — disabled + deprecated models filtered");
  {
    const result = pickBestModel(CATALOG, { capabilities: { reasoning: 1 } });
    assert(
      !result.candidates.some((c) => c.slug === "deprecated/old-model"),
      "deprecated model excluded",
    );
    assert(
      !result.candidates.some((c) => c.slug === "disabled/internal-model"),
      "disabled model excluded",
    );
    assert(
      result.filtered.some((f) => f.slug === "deprecated/old-model" && f.reason === "deprecated"),
      "deprecated reason logged",
    );
  }

  console.log("\n• Group 3 — operator's rule: '9 cheaper wins over 10 expensive' on reasoning task");
  {
    // Profile: pure reasoning, medium cost sensitivity.
    const profile: TaskProfile = {
      capabilities: { reasoning: 1 },
      costSensitivity: "medium",
    };
    const result = pickBestModel(CATALOG, profile, { topN: 10 });
    // Opus (10 reasoning, $60/M effective) is excluded by T-critical floor.
    // Among remaining: Sonnet (9, $12/M), Hermes-405b (9, $7.5/M),
    // Hermes-70b (7, $1/M), Haiku (7, $3.6/M), Gemini-flash (7, $0.24/M),
    // gpt-4o-mini (6, $0.49/M).
    //
    // Value scores at medium sensitivity (exp=1):
    //   sonnet: 9 / (12/3) = 9 / 4 = 2.25
    //   hermes-405b: 9 / (7.5/3) = 9 / 2.5 = 3.6
    //   hermes-70b: 7 / (1/3) = 7 / 0.333 = 21.0
    //   haiku: 7 / (3.6/3) = 7 / 1.2 = 5.83
    //   gemini-flash: 7 / (0.24/3) = 7 / 0.08 = 87.5
    //   gpt-4o-mini: 6 / (0.49/3) = 6 / 0.163 = 36.8
    //
    // Winner: gemini-flash (highest value). It's a 7-scorer but
    // ridiculously cheap. Sonnet (9) loses to flash (7) — exactly the
    // pattern the operator described.
    const pick = result.pick!;
    assert(pick.slug === "google/gemini-2-flash", `winner = gemini-flash (got ${pick.slug})`);
    const sonnet = result.candidates.find((c) => c.slug === "anthropic/claude-sonnet-4.6");
    assert(sonnet !== undefined, "sonnet present in top-N (topN=10)");
    assert(
      sonnet !== undefined && pick.valueScore > sonnet.valueScore,
      "flash valueScore > sonnet valueScore (9-cheaper > 10-expensive emerges from algorithm)",
    );
    assert(
      pick.capabilityMatchScore < (sonnet?.capabilityMatchScore ?? 99),
      `winner (${pick.capabilityMatchScore.toFixed(1)}) has LOWER capability score than sonnet (${sonnet?.capabilityMatchScore.toFixed(1)}) but wins on value`,
    );
  }

  console.log("\n• Group 4 — qualityFloor forces a higher-quality (more expensive) pick");
  {
    // Same reasoning task but require a capability score >= 8.
    const profile: TaskProfile = {
      capabilities: { reasoning: 1 },
      qualityFloor: 8,
      costSensitivity: "medium",
    };
    const result = pickBestModel(CATALOG, profile);
    // Floor 8 excludes haiku (7), hermes-70b (7), flash (7), gpt-4o-mini (6).
    // Remaining: sonnet (9), hermes-405b (9). hermes-405b is cheaper per
    // M effective tokens ($7.5/M vs $12/M) and same quality.
    const pick = result.pick!;
    assert(
      pick.slug === "nousresearch/hermes-4-405b",
      `floored pick = hermes-4-405b (got ${pick.slug})`,
    );
    assert(
      !result.candidates.some((c) => c.slug === "anthropic/claude-haiku-4-5"),
      "haiku excluded by quality floor",
    );
  }

  console.log("\n• Group 5 — costSensitivity high prefers cheaper even more aggressively");
  {
    const profile: TaskProfile = {
      capabilities: { reasoning: 1, tool_use: 0.5 },
      costSensitivity: "high",
    };
    const result = pickBestModel(CATALOG, profile);
    const pick = result.pick!;
    assert(
      pick.provider === "google" || pick.slug === "openai/gpt-4o-mini" || pick.provider === "nousresearch",
      `high-cost-sensitivity prefers a cheap model (got ${pick.slug})`,
    );
  }

  console.log("\n• Group 6 — costSensitivity low + maxCostIndex floor pins premium quality");
  {
    // The honest operator path for "quality first, cost as a tiebreaker"
    // is `costSensitivity: low` + an explicit `maxCostIndex` so the cheap
    // outliers (gemini-flash at $0.24/M) are gated out. With them gone,
    // the highest-capability candidate among the remaining set wins.
    const profile: TaskProfile = {
      capabilities: { reasoning: 1, tool_use: 1 },
      costSensitivity: "low",
      maxCostIndex: 15, // excludes opus ($60/M); keeps sonnet ($12/M) and below
      qualityFloor: 9, // hard quality bar — only sonnet's 9.5 capability passes
    };
    const result = pickBestModel(CATALOG, profile, { topN: 10 });
    const pick = result.pick!;
    assert(pick.capabilityMatchScore >= 8, `quality floor enforced (got ${pick.capabilityMatchScore.toFixed(1)})`);
    // Sonnet has reasoning=9 + tool_use=10 -> 9.5 capability. Hermes-405b
    // has reasoning=9 + tool_use=7 -> 8.0. Sonnet wins on capability.
    // At low sensitivity sonnet should be the pick.
    assert(
      pick.slug === "anthropic/claude-sonnet-4.6",
      `low-sensitivity + quality-floor picks sonnet (got ${pick.slug})`,
    );
  }

  console.log("\n• Group 6b — sensitivity tuning shifts the ranking");
  {
    const profile: TaskProfile = {
      capabilities: { reasoning: 1, tool_use: 1 },
    };
    const high = pickBestModel(CATALOG, { ...profile, costSensitivity: "high" }, { topN: 10 });
    const low = pickBestModel(CATALOG, { ...profile, costSensitivity: "low" }, { topN: 10 });
    const sonnetHighIdx = high.candidates.findIndex((c) => c.slug === "anthropic/claude-sonnet-4.6");
    const sonnetLowIdx = low.candidates.findIndex((c) => c.slug === "anthropic/claude-sonnet-4.6");
    assert(sonnetHighIdx >= 0 && sonnetLowIdx >= 0, "sonnet visible in both top-10 rankings");
    assert(
      sonnetLowIdx <= sonnetHighIdx,
      `sonnet at idx ${sonnetLowIdx} (low) <= idx ${sonnetHighIdx} (high) — premium ranks higher at low sensitivity`,
    );
  }

  console.log("\n• Group 7 — hard requirement: long_context forces gemini-flash");
  {
    const profile: TaskProfile = {
      capabilities: { long_context: 1, summarization: 1 },
      requires: { minContextTokens: 500000 },
    };
    const result = pickBestModel(CATALOG, profile);
    assert(result.pick?.slug === "google/gemini-2-flash", "500k+ context requirement -> gemini-flash");
    assert(
      result.filtered.some((f) => f.reason.includes("context")),
      "context-too-small models named in filtered list",
    );
  }

  console.log("\n• Group 8 — vision requirement excludes Hermes (no vision support)");
  {
    const profile: TaskProfile = {
      capabilities: { vision: 1, summarization: 0.5 },
      requires: { vision: true },
    };
    const result = pickBestModel(CATALOG, profile);
    assert(
      !result.candidates.some((c) => c.provider === "nousresearch"),
      "no Hermes in vision-required pick",
    );
    assert(
      result.filtered.some((f) => f.slug.includes("hermes") && f.reason.includes("vision")),
      "Hermes filtered with vision reason",
    );
  }

  console.log("\n• Group 9 — providerAllowlist restricts to a single vendor");
  {
    const profile: TaskProfile = {
      capabilities: { reasoning: 1 },
      requires: { providerAllowlist: ["anthropic"] },
    };
    const result = pickBestModel(CATALOG, profile);
    assert(
      result.candidates.every((c) => c.provider === "anthropic"),
      "all candidates are anthropic",
    );
    // Sonnet is the only non-T-critical anthropic with reasoning; Haiku is
    // also non-T-critical. Both should appear.
    assert(
      result.candidates.some((c) => c.slug === "anthropic/claude-sonnet-4.6"),
      "sonnet in allowlist results",
    );
  }

  console.log("\n• Group 10 — providerBlocklist removes a vendor");
  {
    const profile: TaskProfile = {
      capabilities: { tool_use: 1 },
      requires: { providerBlocklist: ["anthropic"] },
    };
    const result = pickBestModel(CATALOG, profile);
    assert(
      result.candidates.every((c) => c.provider !== "anthropic"),
      "anthropic excluded by blocklist",
    );
  }

  console.log("\n• Group 11 — maxCostIndex cap excludes runaway-expensive candidates");
  {
    // Allow T-critical so opus is in the pool, but cap cost at $20/M effective.
    const profile: TaskProfile = {
      capabilities: { reasoning: 1 },
      maxCostIndex: 20,
    };
    const result = pickBestModel(CATALOG, profile, { excludeTCritical: false });
    assert(
      !result.candidates.some((c) => c.slug === "anthropic/claude-opus-4.8"),
      "opus-4.8 (effective $60/M) excluded by $20 cap",
    );
    assert(
      result.filtered.some((f) => f.slug === "anthropic/claude-opus-4.8" && f.reason.includes("cost")),
      "opus filtered with cost reason",
    );
  }

  console.log("\n• Group 12 — empty profile (no capabilities) ranks purely by cost");
  {
    const profile: TaskProfile = { capabilities: {} };
    const result = pickBestModel(CATALOG, profile);
    const pick = result.pick!;
    // All eligible candidates score neutral 5; the cheapest wins.
    // gemini-flash at $0.24/M effective is cheapest.
    assert(pick.slug === "google/gemini-2-flash", `cheapest wins on empty profile (got ${pick.slug})`);
  }

  console.log("\n• Group 13 — scoreCandidate rationale names the top capabilities");
  {
    const sonnet = CATALOG.find((c) => c.slug === "anthropic/claude-sonnet-4.6")!;
    const scored = scoreCandidate(
      sonnet,
      { capabilities: { reasoning: 1, tool_use: 1, code_generation: 1 } },
      3.0,
    );
    assert(scored.rationale.includes("anthropic/claude-sonnet-4.6"), "rationale names slug");
    assert(scored.rationale.includes("tool_use=10.0"), "rationale names top capability");
    assert(scored.breakdown.reasoning !== undefined, "breakdown has reasoning entry");
    assert(
      Math.abs(scored.breakdown.tool_use!.weight - 1 / 3) < 1e-6,
      "weights normalized (1/3 each)",
    );
  }

  console.log("\n• Group 14 — filterCandidates utility matches the picker's hard gates");
  {
    const filtered = filterCandidates(CATALOG, {
      capabilities: { reasoning: 1 },
      requires: { tools: true, minContextTokens: 200000 },
    });
    assert(
      filtered.every((c) => c.supportsTools && c.contextWindowTokens >= 200000),
      "every kept candidate satisfies the gates",
    );
    assert(filtered.length >= 1, "at least one anthropic 200k model passes");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
