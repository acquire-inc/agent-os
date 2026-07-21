// Pure unit tests for judge calibration (no DB).
// Run: pnpm --filter @agent-os/core test:judge-calibration
import {
  CALIBRATION_MIN_SAMPLE,
  calibrateJudge,
  runJudgeCalibration,
  type CalibrationPair,
  type CalibrationSink,
  type CalibrationReport,
} from "./judge-calibration.js";

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

let seq = 0;
const pair = (q: CalibrationPair["quorumOutcome"], h: CalibrationPair["humanDecision"]): CalibrationPair => ({
  approvalId: `ap-${++seq}`,
  quorumOutcome: q,
  humanDecision: h,
});

const N = (n: number, f: () => CalibrationPair) => Array.from({ length: n }, f);

async function main() {
  console.log("\n[agreement semantics]");
  {
    const r = calibrateJudge([...N(10, () => pair("approved", "approved"))]);
    assert(r.agreementRate === 1 && !r.drifted, "quorum-approve + human-approve = agreement");
  }
  {
    const r = calibrateJudge([...N(10, () => pair("escalate_to_human", "rejected"))]);
    assert(r.agreementRate === 1 && !r.drifted, "escalation before a human rejection = warranted escalation = agreement");
  }

  console.log("\n[sample floor]");
  {
    const r = calibrateJudge(N(CALIBRATION_MIN_SAMPLE - 1, () => pair("approved", "rejected")));
    assert(!r.drifted, "below min sample → never drifted (no verdict)");
    assert(/keep collecting/.test(r.rationale), "rationale says keep collecting");
  }
  {
    const r = calibrateJudge([]);
    assert(r.sampleSize === 0 && r.agreementRate === 0 && !r.drifted, "empty input is NaN-free and quiet");
  }

  console.log("\n[false approvals — the dangerous direction trips first]");
  {
    // 1 false approval in 10 = 10% > 5% cap → drift even though agreement 90% >= 80% floor.
    const pairs = [...N(9, () => pair("approved", "approved")), pair("approved", "rejected")];
    const r = calibrateJudge(pairs);
    assert(r.falseApprovals === 1, "false approval counted");
    assert(r.drifted, "false-approval rate above cap → drift");
    assert(/green-lit/.test(r.rationale), "rationale names the danger direction");
  }
  {
    // False escalations are friction, not danger: 2 in 10 → agreement 80% == floor → healthy.
    const pairs = [...N(8, () => pair("approved", "approved")), ...N(2, () => pair("escalate_to_human", "approved"))];
    const r = calibrateJudge(pairs);
    assert(r.falseEscalations === 2, "false escalations counted");
    assert(!r.drifted, "false escalations at floor boundary do not trip drift");
  }

  console.log("\n[agreement floor]");
  {
    // 7/10 agreement, all misses being false escalations (not approvals) → 70% < 80% → drift.
    const pairs = [...N(7, () => pair("approved", "approved")), ...N(3, () => pair("escalate_to_human", "approved"))];
    const r = calibrateJudge(pairs);
    assert(r.drifted, "agreement below floor → drift");
    assert(/judge drift/.test(r.rationale), "rationale names judge drift");
  }

  console.log("\n[doctrine — calibration reports, never adjusts]");
  {
    // The report type exposes NO policy fields — it cannot carry a mutated
    // quorum/stake/threshold back to the caller. Enumerated so a future
    // "auto-tune" addition forces a doctrine conversation.
    const r = calibrateJudge(N(10, () => pair("approved", "approved")));
    const keys = Object.keys(r).sort().join(",");
    assert(
      keys === "agreementRate,agreements,drifted,falseApprovals,falseEscalations,rationale,sampleSize",
      `CalibrationReport surface is measurement-only (got ${keys})`,
    );
  }

  console.log("\n[runJudgeCalibration — sink wiring]");
  {
    const emitted: CalibrationReport[] = [];
    const sink: CalibrationSink = {
      async loadPairs() {
        return [...N(9, () => pair("approved", "approved")), pair("approved", "rejected")];
      },
      async emitDrift(input) {
        emitted.push(input.report);
      },
    };
    const r = await runJudgeCalibration("t1", sink);
    assert(r.drifted, "drift detected through the sink");
    assert(emitted.length === 1, "drift emitted");
  }
  {
    const emitted: CalibrationReport[] = [];
    const sink: CalibrationSink = {
      async loadPairs() {
        return N(20, () => pair("approved", "approved"));
      },
      async emitDrift(input) {
        emitted.push(input.report);
      },
    };
    const r = await runJudgeCalibration("t1", sink);
    assert(!r.drifted && emitted.length === 0, "healthy → quiet (no emit)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
