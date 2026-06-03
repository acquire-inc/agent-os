// Agent scorecard tests.
// Run: pnpm --filter @agent-os/core test:scorecard

import {
  DEFAULT_THRESHOLDS,
  scoreAgent,
  type RunSample,
  type Scorecard,
  type ScorecardThresholds,
} from "./scorecard.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function cleanRun(): RunSample {
  return {
    status: "done",
    verificationPassed: true,
    approvalApproved: true,
    approvalRejected: false,
    costUsd: 0.2,
    budgetCapUsd: 2.0,
    findingsHighMed: 0,
    cantfailEventCount: 0,
    scopeLockRefusals: 0,
    outputQualityFailed: false,
  };
}

function withOverride(base: RunSample, patch: Partial<RunSample>): RunSample {
  return { ...base, ...patch };
}

function fill(n: number, sample: RunSample | (() => RunSample)): RunSample[] {
  const arr: RunSample[] = [];
  for (let i = 0; i < n; i++) arr.push(typeof sample === "function" ? sample() : { ...sample });
  return arr;
}

function main() {
  console.log("• Group 1 — insufficient_data when window < minSampleSize");
  {
    const card = scoreAgent(fill(5, cleanRun()));
    assert(card.verdict === "insufficient_data", `verdict=insufficient_data (got ${card.verdict})`);
    assert(card.sampleSize === 5, "sampleSize reflects input");
    assert(card.triggeredThresholds.length === 0, "no thresholds triggered on insufficient data");
  }

  console.log("\n• Group 2 — force_demote_safety on ANY cantfail event (overrides everything)");
  {
    const runs = fill(50, cleanRun());
    runs[10] = withOverride(runs[10]!, { cantfailEventCount: 1 });
    const card = scoreAgent(runs);
    assert(card.verdict === "force_demote_safety", "verdict=force_demote_safety");
    assert(card.cantfailEvents === 1, "cantfailEvents=1");
    assert(card.triggeredThresholds.includes("cantfailEvents > 0"), "triggered threshold names the safety floor");
  }

  console.log("\n• Group 3 — promote when all clearance bars met");
  {
    const runs = fill(25, cleanRun());
    const card = scoreAgent(runs);
    assert(card.verdict === "promote", `verdict=promote (got ${card.verdict})`);
    assert(card.approvalRate === 1.0, "approvalRate=1.0");
    assert(card.verificationRate === 1.0, "verificationRate=1.0");
    assert(Math.abs(card.avgCostUtilization - 0.1) < 1e-9, "avgCostUtilization≈0.1 (0.2 / 2.0)");
  }

  console.log("\n• Group 4 — hold when no approval cycle in window");
  {
    const runs = fill(25, () =>
      withOverride(cleanRun(), { approvalApproved: false, approvalRejected: false }),
    );
    const card = scoreAgent(runs);
    assert(card.verdict === "hold", `verdict=hold (got ${card.verdict})`);
    assert(Number.isNaN(card.approvalRate), "approvalRate=NaN");
    assert(
      card.rationale.includes("no approval cycle"),
      `rationale names the no-approval reason (got: ${card.rationale})`,
    );
  }

  console.log("\n• Group 5 — demote when verification rate too low");
  {
    const runs = fill(25, cleanRun());
    // 80% pass, 20% fail — below 0.85 threshold.
    for (let i = 0; i < 5; i++) runs[i] = withOverride(runs[i]!, { verificationPassed: false });
    const card = scoreAgent(runs);
    assert(card.verdict === "demote", `verdict=demote (got ${card.verdict})`);
    assert(card.verificationRate === 0.8, "verificationRate=0.8");
    assert(
      card.triggeredThresholds.some((t) => t.includes("verificationRate")),
      "triggered threshold names verification",
    );
  }

  console.log("\n• Group 6 — demote when cost utilization too high");
  {
    const runs = fill(25, () =>
      withOverride(cleanRun(), { costUsd: 1.9, budgetCapUsd: 2.0 }),
    );
    const card = scoreAgent(runs);
    assert(card.verdict === "demote", `verdict=demote (got ${card.verdict})`);
    assert(Math.abs(card.avgCostUtilization - 0.95) < 1e-9, "avgCostUtilization≈0.95");
    assert(
      card.triggeredThresholds.some((t) => t.includes("avgCostUtilization")),
      "triggered threshold names cost utilization",
    );
  }

  console.log("\n• Group 7 — demote when findings rate exceeds threshold");
  {
    const runs = fill(25, cleanRun());
    // Plant 5 runs with high findings -> 0.2 per run avg > 0.1 threshold.
    for (let i = 0; i < 5; i++) runs[i] = withOverride(runs[i]!, { findingsHighMed: 1 });
    const card = scoreAgent(runs);
    assert(card.verdict === "demote", `verdict=demote (got ${card.verdict})`);
    assert(card.findingsRatePerRun === 0.2, "findingsRatePerRun=0.2");
  }

  console.log("\n• Group 8 — demote when scope-lock refusals exceed threshold");
  {
    const runs = fill(25, cleanRun());
    for (let i = 0; i < 20; i++) runs[i] = withOverride(runs[i]!, { scopeLockRefusals: 1 });
    const card = scoreAgent(runs);
    assert(card.verdict === "demote", `verdict=demote (got ${card.verdict})`);
    assert(card.scopeLockRefusalsPerRun === 0.8, "scopeLockRefusalsPerRun=0.8 (>0.5)");
  }

  console.log("\n• Group 9 — demote when output-quality failure rate too high");
  {
    const runs = fill(25, cleanRun());
    for (let i = 0; i < 5; i++) runs[i] = withOverride(runs[i]!, { outputQualityFailed: true });
    const card = scoreAgent(runs);
    assert(card.verdict === "demote", `verdict=demote (got ${card.verdict})`);
    assert(card.outputQualityFailureRate === 0.2, "outputQualityFailureRate=0.2 (>0.1)");
  }

  console.log("\n• Group 10 — hold when verification just above floor but below promote bar");
  {
    const runs = fill(25, cleanRun());
    // 0.88 verification -> above 0.85 (no demote) but below 0.95 (no promote)
    for (let i = 0; i < 3; i++) runs[i] = withOverride(runs[i]!, { verificationPassed: false });
    const card = scoreAgent(runs);
    assert(card.verdict === "hold", `verdict=hold (got ${card.verdict})`);
    assert(card.verificationRate === 0.88, "verificationRate=0.88");
  }

  console.log("\n• Group 11 — custom thresholds (agent-onboarder tight cycle)");
  {
    const tight: ScorecardThresholds = {
      ...DEFAULT_THRESHOLDS,
      minSampleSize: 5,
      minApprovalRateForPromote: 0.6,
    };
    const runs = fill(5, cleanRun());
    const card = scoreAgent(runs, tight);
    assert(card.verdict === "promote", `tight thresholds allow promote with N=5 (got ${card.verdict})`);
  }

  console.log("\n• Group 12 — empty input returns insufficient_data");
  {
    const card = scoreAgent([]);
    assert(card.verdict === "insufficient_data", `empty -> insufficient_data (got ${card.verdict})`);
    assert(card.sampleSize === 0, "sampleSize=0");
  }

  console.log("\n• Group 13 — Scorecard rationale is non-empty on every verdict");
  {
    const verdicts: Scorecard[] = [
      scoreAgent([], DEFAULT_THRESHOLDS),
      scoreAgent(fill(25, cleanRun())),
      scoreAgent(fill(25, () => withOverride(cleanRun(), { verificationPassed: false }))),
    ];
    for (const v of verdicts) {
      assert(v.rationale.length > 0, `verdict=${v.verdict} has non-empty rationale`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
