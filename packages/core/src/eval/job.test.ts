// Scorecard job orchestration tests.
// Run: pnpm --filter @agent-os/core test:job

import { runScorecardJob, type ScorecardJobSink } from "./job.js";
import type { RunSample } from "./scorecard.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
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
    outputQualityApplied: true,
    outputQualityFailed: false,
  };
}

interface SinkRecord {
  persistedScorecards: unknown[];
  applyAutonomyCalls: unknown[];
  markAppliedCalls: unknown[];
}

function makeSink(
  samples: RunSample[],
  applyResult: { id: string; autonomy: string } | null = { id: "agent-1", autonomy: "execute_safe" },
): { sink: ScorecardJobSink; record: SinkRecord } {
  const record: SinkRecord = {
    persistedScorecards: [],
    applyAutonomyCalls: [],
    markAppliedCalls: [],
  };
  const sink: ScorecardJobSink = {
    fetchRunSamples: async () => samples,
    persistScorecard: async (s) => {
      record.persistedScorecards.push(s);
      return `scorecard-${record.persistedScorecards.length}`;
    },
    applyAutonomy: async (a) => {
      record.applyAutonomyCalls.push(a);
      return applyResult;
    },
    markApplied: async (m) => {
      record.markAppliedCalls.push(m);
    },
  };
  return { sink, record };
}

async function main() {
  const baseInputs = {
    tenantId: "tenant-1",
    agentId: "agent-1",
    agentKey: "vitals",
    currentAutonomy: "propose" as const,
    isCantFail: false,
    windowStart: new Date("2026-01-01T00:00:00Z"),
    windowEnd: new Date("2026-01-31T23:59:59Z"),
  };

  console.log("• Group 1 — clean 25-sample window → promote + autonomy applied");
  {
    const samples: RunSample[] = Array.from({ length: 25 }, () => cleanRun());
    const { sink, record } = makeSink(samples);
    const result = await runScorecardJob(baseInputs, sink);
    assert(result.verdict === "promote", `verdict=promote (got ${result.verdict})`);
    assert(result.autonomyChanged === true, "autonomyChanged=true");
    assert(result.nextAutonomy === "execute_safe", "nextAutonomy=execute_safe");
    assert(result.sampleSize === 25, "sampleSize=25");
    assert(record.persistedScorecards.length === 1, "scorecard persisted once");
    assert(record.applyAutonomyCalls.length === 1, "applyAutonomy called once");
    assert(record.markAppliedCalls.length === 1, "markApplied called once");
    const mark = record.markAppliedCalls[0] as { appliedAutonomy: string };
    assert(mark.appliedAutonomy === "execute_safe", `mark.appliedAutonomy=execute_safe`);
  }

  console.log("\n• Group 2 — insufficient_data (small window) → no autonomy mutation");
  {
    const samples: RunSample[] = Array.from({ length: 5 }, () => cleanRun());
    const { sink, record } = makeSink(samples);
    const result = await runScorecardJob(baseInputs, sink);
    assert(result.verdict === "insufficient_data", "verdict=insufficient_data");
    assert(result.autonomyChanged === false, "autonomyChanged=false");
    assert(result.appliedAutonomy === "unchanged", "appliedAutonomy=unchanged");
    assert(record.applyAutonomyCalls.length === 0, "applyAutonomy NOT called");
    assert(record.markAppliedCalls.length === 1, "markApplied still called (records no-op)");
  }

  console.log("\n• Group 3 — force_demote_safety on cantfail signal");
  {
    const samples: RunSample[] = Array.from({ length: 25 }, () => cleanRun());
    samples[0] = { ...samples[0]!, cantfailEventCount: 1 };
    const inputs = { ...baseInputs, currentAutonomy: "execute_full" as const };
    const { sink, record } = makeSink(samples, { id: "agent-1", autonomy: "propose" });
    const result = await runScorecardJob(inputs, sink);
    assert(result.verdict === "force_demote_safety", "verdict=force_demote_safety");
    assert(result.nextAutonomy === "propose", "nextAutonomy=propose");
    assert(result.autonomyChanged === true, "autonomyChanged=true");
    const persisted = record.persistedScorecards[0] as { cantfailEvents: number };
    assert(persisted.cantfailEvents === 1, "persisted cantfailEvents=1");
  }

  console.log("\n• Group 4 — cant-fail agent capped at execute_safe on promote");
  {
    const samples: RunSample[] = Array.from({ length: 25 }, () => cleanRun());
    const inputs = {
      ...baseInputs,
      isCantFail: true,
      currentAutonomy: "execute_safe" as const,
    };
    const { sink, record } = makeSink(samples, { id: "agent-1", autonomy: "execute_safe" });
    const result = await runScorecardJob(inputs, sink);
    assert(result.verdict === "promote", `verdict=promote`);
    // Cant-fail at execute_safe + promote → stays at execute_safe (no change).
    assert(result.nextAutonomy === "execute_safe", "nextAutonomy=execute_safe (cant-fail cap)");
    assert(result.autonomyChanged === false, "autonomyChanged=false (already at cap)");
    assert(record.applyAutonomyCalls.length === 0, "applyAutonomy NOT called when no change");
  }

  console.log("\n• Group 5 — persistScorecard receives NaN as null");
  {
    // No approval cycle in window → approvalRate=NaN; persist should send null.
    const samples: RunSample[] = Array.from({ length: 25 }, () =>
      ({ ...cleanRun(), approvalApproved: false, approvalRejected: false }),
    );
    const { sink, record } = makeSink(samples);
    await runScorecardJob(baseInputs, sink);
    const persisted = record.persistedScorecards[0] as { approvalRate: number | null };
    assert(persisted.approvalRate === null, "approvalRate=null in persisted row");
  }

  console.log("\n• Group 6 — applyAutonomy returning null still marks scorecard applied as 'unchanged'");
  {
    const samples: RunSample[] = Array.from({ length: 25 }, () => cleanRun());
    const { sink, record } = makeSink(samples, null); // simulate agent-not-found path
    const result = await runScorecardJob(baseInputs, sink);
    assert(result.autonomyChanged === true, "autonomyChanged=true (decision wanted change)");
    assert(result.appliedAutonomy === "unchanged", "appliedAutonomy=unchanged (db returned null)");
    assert(record.markAppliedCalls.length === 1, "markApplied still called");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
