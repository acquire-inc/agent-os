// Phase 35 integration test: scorecard job end-to-end.
//
// Asserts the runScorecardJob orchestration through a realistic stubbed
// sink. The sink behaves like the production Drizzle-backed sink would,
// but without touching the database — fetchRunSamples returns a
// deterministic window, persistScorecard captures the row, applyAutonomy
// records the mutation, markApplied records the patch.
//
// Run: pnpm --filter @agent-os/core test:scorecard-flow

import { runScorecardJob, type ScorecardJobSink } from "./job.js";
import type { RunSample } from "./scorecard.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function cleanRun(overrides: Partial<RunSample> = {}): RunSample {
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
    outputQualityApplied: true,
    outputQualityFailed: false,
    ...overrides,
  };
}

interface SinkLog {
  samples: RunSample[];
  persistedScorecards: unknown[];
  applyAutonomyCalls: { tenantId: string; agentId: string; nextAutonomy: string; reason: string }[];
  markAppliedCalls: { scorecardId: string; appliedAutonomy: string }[];
}

function makeSink(samples: RunSample[], applyResult: { id: string; autonomy: string } | null) {
  const log: SinkLog = {
    samples,
    persistedScorecards: [],
    applyAutonomyCalls: [],
    markAppliedCalls: [],
  };
  const sink: ScorecardJobSink = {
    fetchRunSamples: async () => log.samples,
    persistScorecard: async (sc) => {
      log.persistedScorecards.push(sc);
      return `scorecard-${log.persistedScorecards.length}`;
    },
    applyAutonomy: async (a) => {
      log.applyAutonomyCalls.push(a);
      return applyResult;
    },
    markApplied: async (m) => {
      log.markAppliedCalls.push({ scorecardId: m.scorecardId, appliedAutonomy: m.appliedAutonomy });
    },
  };
  return { sink, log };
}

const BASE_INPUTS = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  agentKey: "weekly-report",
  currentAutonomy: "propose" as const,
  isCantFail: false,
  windowStart: new Date("2026-01-01T00:00:00Z"),
  windowEnd: new Date("2026-01-31T23:59:59Z"),
};

async function main() {
  console.log("• Group 1 — promote with realistic 25-run clean window");
  {
    const samples = Array.from({ length: 25 }, () => cleanRun());
    const { sink, log } = makeSink(samples, { id: "agent-1", autonomy: "execute_safe" });
    const result = await runScorecardJob(BASE_INPUTS, sink);
    assert(result.verdict === "promote", "verdict=promote");
    assert(result.appliedAutonomy === "execute_safe", "applied moves to execute_safe");
    assert(log.applyAutonomyCalls.length === 1, "applyAutonomy called once");
    assert(log.applyAutonomyCalls[0]!.reason.includes("promote"), "reason mentions promote");
    assert(log.markAppliedCalls[0]!.appliedAutonomy === "execute_safe", "markApplied records execute_safe");
  }

  console.log("\n• Group 2 — cantfail event forces demote regardless of other signals");
  {
    const samples = Array.from({ length: 25 }, () => cleanRun());
    samples[10] = cleanRun({ cantfailEventCount: 1 });
    const inputs = { ...BASE_INPUTS, currentAutonomy: "execute_full" as const };
    const { sink, log } = makeSink(samples, { id: "agent-1", autonomy: "propose" });
    const result = await runScorecardJob(inputs, sink);
    assert(result.verdict === "force_demote_safety", "verdict=force_demote_safety");
    assert(result.nextAutonomy === "propose", "nextAutonomy=propose");
    assert(log.applyAutonomyCalls[0]!.reason.includes("force_demote_safety"), "reason mentions force_demote_safety");
  }

  console.log("\n• Group 3 — output-quality skill failures only count when applied (CR-02 fix)");
  {
    // 25 runs; 20 have outputQualityApplied=false (skill not bound), 5 do
    // have it applied and 5 of those failed (rate = 100% of applications).
    const samples = Array.from({ length: 25 }, (_, i) => {
      if (i < 20) return cleanRun({ outputQualityApplied: false, outputQualityFailed: true });
      return cleanRun({ outputQualityApplied: true, outputQualityFailed: true });
    });
    const { sink } = makeSink(samples, { id: "agent-1", autonomy: "propose" });
    const result = await runScorecardJob(BASE_INPUTS, sink);
    // 5 fails over 5 applications = 100% > 10% threshold -> demote
    assert(result.verdict === "demote", `verdict=demote (got ${result.verdict})`);
    const sc = sink as unknown as { log?: SinkLog };
    void sc;
  }

  console.log("\n• Group 4 — cant-fail agent at execute_safe with promote signal stays capped");
  {
    const samples = Array.from({ length: 25 }, () => cleanRun());
    const inputs = {
      ...BASE_INPUTS,
      isCantFail: true,
      currentAutonomy: "execute_safe" as const,
    };
    const { sink, log } = makeSink(samples, { id: "agent-1", autonomy: "execute_safe" });
    const result = await runScorecardJob(inputs, sink);
    assert(result.verdict === "promote", "scorecard says promote");
    assert(result.nextAutonomy === "execute_safe", "next autonomy capped at execute_safe");
    assert(result.autonomyChanged === false, "no autonomy change applied");
    assert(log.applyAutonomyCalls.length === 0, "applyAutonomy NOT called (controller said unchanged)");
    assert(log.markAppliedCalls.length === 1, "markApplied still called (audit trail)");
  }

  console.log("\n• Group 5 — multi-trip demote names every threshold in the rationale");
  {
    const samples = Array.from({ length: 25 }, () =>
      cleanRun({
        verificationPassed: false, // verification rate = 0
        findingsHighMed: 2, // findings rate = 2
        scopeLockRefusals: 3, // scope-lock rate = 3
        costUsd: 1.9, // cost util = 0.95
      }),
    );
    const { sink, log } = makeSink(samples, { id: "agent-1", autonomy: "propose" });
    const result = await runScorecardJob({ ...BASE_INPUTS, currentAutonomy: "execute_full" }, sink);
    assert(result.verdict === "demote", "verdict=demote");
    const persisted = log.persistedScorecards[0] as { triggeredThresholds: string[]; rationale: string };
    assert(persisted.triggeredThresholds.length >= 4, `>= 4 thresholds tripped (got ${persisted.triggeredThresholds.length})`);
    assert(persisted.rationale.includes("verificationRate"), "rationale names verificationRate");
    assert(persisted.rationale.includes("avgCostUtilization"), "rationale names avgCostUtilization");
  }

  console.log("\n• Group 6 — empty window flows through as insufficient_data + still persists");
  {
    const { sink, log } = makeSink([], null);
    const result = await runScorecardJob(BASE_INPUTS, sink);
    assert(result.verdict === "insufficient_data", "verdict=insufficient_data");
    assert(result.appliedAutonomy === "unchanged", "appliedAutonomy=unchanged");
    assert(log.persistedScorecards.length === 1, "scorecard persisted (audit trail complete)");
    assert(log.applyAutonomyCalls.length === 0, "applyAutonomy NOT called");
    assert(log.markAppliedCalls.length === 1, "markApplied still called");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
