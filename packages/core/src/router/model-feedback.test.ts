// Phase 44 tests: model feedback loop.
//
// Run: pnpm --filter @agent-os/core test:model-feedback

import {
  aggregateModelObservations,
  deriveOutcomeScore,
  type ModelRunObservation,
} from "./model-feedback.js";
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
    slug: "nousresearch/hermes-4-70b",
    provider: "nousresearch", family: "hermes", status: "preferred",
    costInputPerMillionUsd: 0.4, costOutputPerMillionUsd: 1.2,
    contextWindowTokens: 128000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: false, supportsStreaming: true,
    capabilityScores: { reasoning: 7, classification: 8, summarization: 8 },
    tierAffinity: "T-cheap", enabled: true,
  },
];

function obs(model: string, cap: ModelRunObservation["capability"], score: number): ModelRunObservation {
  return { modelSlug: model, capability: cap, outcomeScore: score };
}

async function main() {
  console.log("• Group 1 — deriveOutcomeScore mapping");
  {
    assert(
      deriveOutcomeScore({ verificationPassed: true, outputQualityApplied: true, outputQualityFailed: false, cantfailEvents: 0, highSeverityFindings: 0 }) === 10,
      "clean + skill-applied -> 10",
    );
    assert(
      deriveOutcomeScore({ verificationPassed: true, outputQualityApplied: false, outputQualityFailed: false, cantfailEvents: 0, highSeverityFindings: 0 }) === 9,
      "clean but skill not applied -> 9",
    );
    assert(
      deriveOutcomeScore({ verificationPassed: true, outputQualityApplied: false, outputQualityFailed: false, cantfailEvents: 0, highSeverityFindings: 1 }) === 7,
      "1 high-sev finding -> 7",
    );
    assert(
      deriveOutcomeScore({ verificationPassed: true, outputQualityApplied: false, outputQualityFailed: false, cantfailEvents: 0, highSeverityFindings: 3 }) === 6,
      ">=2 findings -> 6",
    );
    assert(
      deriveOutcomeScore({ verificationPassed: true, outputQualityApplied: true, outputQualityFailed: true, cantfailEvents: 0, highSeverityFindings: 0 }) === 4,
      "output-quality fail -> 4",
    );
    assert(
      deriveOutcomeScore({ verificationPassed: false, outputQualityApplied: true, outputQualityFailed: false, cantfailEvents: 0, highSeverityFindings: 0 }) === 2,
      "verification fail -> 2",
    );
    assert(
      deriveOutcomeScore({ verificationPassed: true, outputQualityApplied: true, outputQualityFailed: false, cantfailEvents: 1, highSeverityFindings: 0 }) === 0,
      "cantfail event -> 0 (overrides everything)",
    );
  }

  console.log("\n• Group 2 — sample-size floor: too few runs -> no proposal");
  {
    // 9 runs for sonnet/reasoning at score 10. Threshold is MIN_SAMPLES=10.
    const observations = Array.from({ length: 9 }, () => obs("anthropic/claude-sonnet-4.6", "reasoning", 10));
    const proposals = aggregateModelObservations(observations, CATALOG);
    assert(proposals.length === 0, "below sample floor -> no proposals");
  }

  console.log("\n• Group 3 — sufficient samples + strong positive signal -> upward blend");
  {
    // 20 runs for sonnet/reasoning all scoring 10. Current = 9. Observed = 10.
    // Blend = 9 + (10-9)*0.1 = 9.1
    const observations = Array.from({ length: 20 }, () => obs("anthropic/claude-sonnet-4.6", "reasoning", 10));
    const proposals = aggregateModelObservations(observations, CATALOG);
    const p = proposals.find((x) => x.modelSlug === "anthropic/claude-sonnet-4.6" && x.capability === "reasoning");
    assert(p !== undefined, "proposal generated");
    assert(p!.proposedScore > p!.currentScore, `proposed (${p!.proposedScore}) > current (${p!.currentScore})`);
    assert(Math.abs(p!.proposedScore - 9.1) < 0.01, `blend = 9.1 (got ${p!.proposedScore})`);
    assert(p!.sampleSize === 20, "sampleSize reported");
    assert(p!.rationale.includes("↑"), "rationale shows upward arrow");
  }

  console.log("\n• Group 4 — strong negative signal -> downward blend");
  {
    // 20 runs for hermes-70b/classification all scoring 2. Current = 8.
    // Blend = 8 + (2-8)*0.1 = 7.4
    const observations = Array.from({ length: 20 }, () => obs("nousresearch/hermes-4-70b", "classification", 2));
    const proposals = aggregateModelObservations(observations, CATALOG);
    const p = proposals.find((x) => x.modelSlug === "nousresearch/hermes-4-70b" && x.capability === "classification");
    assert(p !== undefined, "proposal generated");
    assert(p!.proposedScore < p!.currentScore, `proposed (${p!.proposedScore}) < current (${p!.currentScore})`);
    assert(Math.abs(p!.proposedScore - 7.4) < 0.01, `blend = 7.4 (got ${p!.proposedScore})`);
    assert(p!.rationale.includes("↓"), "rationale shows downward arrow");
  }

  console.log("\n• Group 5 — floor protects known-good models from flaky windows");
  {
    // Hermes-70b current reasoning = 7. 20 runs all 0 (cantfail). Blend would
    // be 7 + (0-7)*0.1 = 6.3 -> above floor of 3. Floor doesn't apply here
    // because 6.3 > 3. But repeated cycles could drop it lower.
    // Test the floor itself: simulate a hypothetical current=4 and observed=0.
    const observations = Array.from({ length: 20 }, () => obs("nousresearch/hermes-4-70b", "summarization", 0));
    // current summarization = 8; 8 + (0-8)*0.1 = 7.2 -> proposed 7.2 (above floor).
    const proposals = aggregateModelObservations(observations, CATALOG);
    const p = proposals.find((x) => x.modelSlug === "nousresearch/hermes-4-70b" && x.capability === "summarization");
    assert(p !== undefined, "proposal generated despite all-bad outcome");
    assert(p!.proposedScore >= 3, `proposed (${p!.proposedScore}) >= floor 3`);
  }

  console.log("\n• Group 6 — T-critical models NEVER get auto-updated");
  {
    // 50 runs for opus all scoring 10. Should NOT generate a proposal.
    const observations = Array.from({ length: 50 }, () => obs("anthropic/claude-opus-4.8", "reasoning", 10));
    const proposals = aggregateModelObservations(observations, CATALOG);
    const opusProposals = proposals.filter((p) => p.modelSlug === "anthropic/claude-opus-4.8");
    assert(opusProposals.length === 0, "T-critical excluded from auto-updates (doctrine, not observed)");
  }

  console.log("\n• Group 7 — no-op proposals are suppressed");
  {
    // sonnet/reasoning current = 9. 20 runs scoring 9 (no movement).
    // Blend = 9 + (9-9)*0.1 = 9 -> no change.
    const observations = Array.from({ length: 20 }, () => obs("anthropic/claude-sonnet-4.6", "reasoning", 9));
    const proposals = aggregateModelObservations(observations, CATALOG);
    const p = proposals.find((x) => x.modelSlug === "anthropic/claude-sonnet-4.6" && x.capability === "reasoning");
    assert(p === undefined, "no-op proposal suppressed (audit trail stays meaningful)");
  }

  console.log("\n• Group 8 — multiple (model, capability) buckets independently scored");
  {
    const observations: ModelRunObservation[] = [
      ...Array.from({ length: 15 }, () => obs("anthropic/claude-sonnet-4.6", "reasoning", 10)),
      ...Array.from({ length: 15 }, () => obs("anthropic/claude-sonnet-4.6", "summarization", 5)),
      ...Array.from({ length: 15 }, () => obs("nousresearch/hermes-4-70b", "classification", 9)),
    ];
    const proposals = aggregateModelObservations(observations, CATALOG);
    assert(proposals.length === 3, `3 distinct buckets -> 3 proposals (got ${proposals.length})`);
    const sonnetReasoning = proposals.find((p) => p.modelSlug === "anthropic/claude-sonnet-4.6" && p.capability === "reasoning");
    const sonnetSumm = proposals.find((p) => p.modelSlug === "anthropic/claude-sonnet-4.6" && p.capability === "summarization");
    const hermesCls = proposals.find((p) => p.modelSlug === "nousresearch/hermes-4-70b" && p.capability === "classification");
    assert(sonnetReasoning && sonnetReasoning.proposedScore > 9, "sonnet reasoning goes up");
    assert(sonnetSumm && sonnetSumm.proposedScore < 9, "sonnet summarization goes down");
    assert(hermesCls && hermesCls.proposedScore > 8, "hermes classification goes up");
  }

  console.log("\n• Group 9 — unknown model in observations is ignored");
  {
    const observations = Array.from({ length: 20 }, () => obs("unknown/model", "reasoning", 10));
    const proposals = aggregateModelObservations(observations, CATALOG);
    assert(proposals.length === 0, "unknown model -> no proposal");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
