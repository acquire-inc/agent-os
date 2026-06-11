// Pure unit tests for the agent memory loop (no DB required).
// Run: pnpm --filter @agent-os/core test:memory
import {
  composeEpisode,
  episodeNamespace,
  formatPriorLearnings,
  heuristicLessons,
  heuristicReflector,
} from "./memory.js";

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

async function main() {
  console.log("\n[namespace — per-agent isolation]");
  assert(episodeNamespace("a1") === "agent/a1/episodes", "namespace is agent-scoped");
  assert(episodeNamespace("a1") !== episodeNamespace("a2"), "different agents → different namespaces");

  console.log("\n[composeEpisode — outcome condensation]");
  const ep = composeEpisode({
    agentKey: "ad-ops",
    day: "2026-06-11",
    summary: "Paused adset 4; ROAS recovered to 1.4.",
    outcome: { status: "done", costUsd: 0.9, budgetCapUsd: 1.0, verificationPassed: true },
    lessons: ["Pause underperforming adsets earlier."],
  });
  assert(ep.includes("outcome: done"), "episode carries outcome status");
  assert(ep.includes("verification: passed"), "episode carries verification");
  assert(ep.includes("cost utilization: 90%"), "episode computes cost utilization");
  assert(ep.includes("## Lessons"), "episode includes lessons section");
  assert(ep.includes("## Summary"), "episode includes summary section");
  const noCap = composeEpisode({ agentKey: "x", day: "2026-06-11", summary: "ok", outcome: { status: "done" } });
  assert(noCap.includes("cost utilization: n/a"), "missing budget → n/a utilization (no divide-by-zero)");

  console.log("\n[heuristicLessons — reacts to outcome]");
  const failL = heuristicLessons({ summary: "Tried to send email but the API returned 500.", outcome: { status: "failed" } });
  assert(failL.some((l) => l.includes("FAILED")), "failed run → failure lesson");
  const rej = heuristicLessons({ summary: "ok", outcome: { status: "done", approvalOutcome: "rejected" } });
  assert(rej.some((l) => l.toLowerCase().includes("rejected")), "rejected approval → conservative lesson");
  const verif = heuristicLessons({ summary: "ok", outcome: { status: "done", verificationPassed: false } });
  assert(verif.some((l) => l.toLowerCase().includes("verification")), "failed verification → re-check lesson");
  const over = heuristicLessons({ summary: "ok", outcome: { status: "done", costUsd: 0.95, budgetCapUsd: 1.0 } });
  assert(over.some((l) => l.toLowerCase().includes("budget")), "near-cap cost → budget lesson");
  assert(heuristicLessons({ summary: "ok", outcome: { status: "done", verificationPassed: false, approvalOutcome: "rejected", costUsd: 9, budgetCapUsd: 1 } }).length <= 5, "lessons capped at 5");

  console.log("\n[reflector default]");
  const r = await heuristicReflector({ summary: "did a thing", outcome: { status: "done" } });
  assert(Array.isArray(r) && r.length > 0, "heuristicReflector returns lessons");

  console.log("\n[formatPriorLearnings — dedup + trim]");
  const f = formatPriorLearnings([{ chunk: " a " }, { chunk: "a" }, { chunk: "b" }, { chunk: "" }]);
  assert(f.length === 2 && f[0] === "a" && f[1] === "b", "dedups, trims, drops empties");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
