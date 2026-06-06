// Phase 46 tests: pre-run cost forecasting.
// Run: pnpm --filter @agent-os/core test:cost-forecast

import { compareForecasts, forecastRunCost } from "./cost-forecast.js";
import type { ModelCatalogEntry } from "./intelligence.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const CATALOG: readonly ModelCatalogEntry[] = [
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
  {
    slug: "google/gemini-2-flash",
    provider: "google", family: "gemini-2", status: "preferred",
    costInputPerMillionUsd: 0.075, costOutputPerMillionUsd: 0.3,
    contextWindowTokens: 1000000, maxOutputTokens: 8192,
    supportsTools: true, supportsReasoning: false, supportsVision: true, supportsStreaming: true,
    capabilityScores: { reasoning: 7, summarization: 8, long_context: 10 },
    tierAffinity: null, enabled: true,
  },
];

async function main() {
  console.log("• Group 1 — forecastRunCost basic arithmetic");
  {
    const sonnet = CATALOG[0]!;
    // 10000 in + 2000 out
    const f = forecastRunCost(sonnet, { inputTokens: 10000, outputTokens: 2000 });
    // input: 10000/1M * $3 = $0.03; output: 2000/1M * $15 = $0.03; total $0.06.
    assert(Math.abs(f.inputCostUsd - 0.03) < 1e-9, `input cost = $0.03 (got ${f.inputCostUsd})`);
    assert(Math.abs(f.outputCostUsd - 0.03) < 1e-9, `output cost = $0.03 (got ${f.outputCostUsd})`);
    assert(Math.abs(f.totalUsd - 0.06) < 1e-9, `total = $0.06 (got ${f.totalUsd})`);
  }

  console.log("\n• Group 2 — gemini-flash is ~80x cheaper than sonnet for same tokens");
  {
    const tokens = { inputTokens: 20000, outputTokens: 3000 };
    const sonnet = forecastRunCost(CATALOG[0]!, tokens);
    const flash = forecastRunCost(CATALOG[2]!, tokens);
    assert(sonnet.totalUsd > flash.totalUsd, "sonnet > flash on cost");
    assert(sonnet.totalUsd / flash.totalUsd > 40, `sonnet >40x more expensive (ratio ${(sonnet.totalUsd / flash.totalUsd).toFixed(1)})`);
  }

  console.log("\n• Group 3 — compareForecasts with no profile: sorted by cost");
  {
    const tokens = { inputTokens: 5000, outputTokens: 1000 };
    const result = compareForecasts({ catalog: CATALOG, tokens });
    assert(result.candidates.length === 3, "3 candidates returned");
    // Cheapest first.
    const slugs = result.candidates.map((c) => c.candidate.slug);
    assert(slugs[0] === "google/gemini-2-flash", `cheapest first (got ${slugs[0]})`);
    assert(slugs[slugs.length - 1] === "anthropic/claude-sonnet-4.6", "most expensive last");
    assert(result.recommended?.candidate.slug === "google/gemini-2-flash", "recommended = cheapest");
  }

  console.log("\n• Group 4 — compareForecasts with profile: candidates ranked by value");
  {
    const tokens = { inputTokens: 5000, outputTokens: 1000 };
    const result = compareForecasts({
      catalog: CATALOG,
      tokens,
      profile: {
        capabilities: { reasoning: 1, summarization: 1 },
        costSensitivity: "medium",
      },
    });
    assert(result.candidates.length === 3, "3 candidates returned (all eligible)");
    // Each candidate has both the value score AND a forecast.
    for (const c of result.candidates) {
      assert(c.candidate.valueScore > 0, `${c.candidate.slug} has valueScore`);
      assert(c.forecast.totalUsd > 0, `${c.candidate.slug} has forecast`);
    }
  }

  console.log("\n• Group 5 — budgetCapUsd filters and recommendation respects cap");
  {
    const tokens = { inputTokens: 100000, outputTokens: 20000 };
    // sonnet: 100k/1M * $3 + 20k/1M * $15 = $0.30 + $0.30 = $0.60
    // hermes-70b: 100k * $0.4 + 20k * $1.2 = $0.04 + $0.024 = $0.064
    // flash: $0.0075 + $0.006 = $0.0135
    const result = compareForecasts({
      catalog: CATALOG,
      tokens,
      profile: {
        capabilities: { reasoning: 1 },
        costSensitivity: "medium",
      },
      budgetCapUsd: 0.05, // tight budget: flash + hermes-70b fit; sonnet doesn't
    });
    for (const c of result.candidates) {
      if (c.candidate.slug === "anthropic/claude-sonnet-4.6") {
        assert(c.withinBudget === false, "sonnet flagged out-of-budget");
      }
      if (c.candidate.slug === "google/gemini-2-flash") {
        assert(c.withinBudget === true, "flash flagged in-budget");
      }
    }
    // Recommended must be within budget.
    assert(
      result.recommended?.withinBudget === true,
      `recommended is within budget (got ${result.recommended?.candidate.slug} -> $${result.recommended?.forecast.totalUsd.toFixed(4)})`,
    );
  }

  console.log("\n• Group 6 — when nothing fits the budget, recommended falls back to top-value");
  {
    const tokens = { inputTokens: 1_000_000, outputTokens: 100_000 };
    // Everything will exceed a $0.01 budget at these token volumes.
    const result = compareForecasts({
      catalog: CATALOG,
      tokens,
      profile: { capabilities: { reasoning: 1 } },
      budgetCapUsd: 0.01,
    });
    assert(
      result.candidates.every((c) => c.withinBudget === false),
      "no candidate fits the impossible budget",
    );
    // Recommended is the top-value candidate as a "best we can do" answer.
    assert(result.recommended !== null, "recommended falls back to top-value");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
