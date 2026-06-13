// Offline test for the architect overlap detector.
// Run: pnpm --filter @agent-os/core test:architect-overlap
import { detectArchitectOverlap, type AgentForOverlap } from "./overlap.js";

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

const a = (key: string, skillKeys: string[] = [], mcpNames: string[] = []): AgentForOverlap => ({
  key,
  skillKeys,
  mcpNames,
});

async function main() {
  console.log("\n[detectArchitectOverlap — no overlap on distinct fleets]");
  assert(
    detectArchitectOverlap([a("ad-ops", ["meta-tools"], ["pipeboard-meta"]), a("triage", ["routing"], ["close"])]).length === 0,
    "distinct connectors AND distinct skills → no warning",
  );
  assert(
    detectArchitectOverlap([a("x", ["s1"], ["c1"]), a("y", ["s1"], ["c2"])]).length === 0,
    "same skill, different connector → no warning",
  );
  assert(
    detectArchitectOverlap([a("x", ["s1"], ["c1"]), a("y", ["s2"], ["c1"])]).length === 0,
    "same connector, different skill → no warning",
  );

  console.log("\n[detectArchitectOverlap — flags shared connector AND skill]");
  {
    const ws = detectArchitectOverlap([
      a("ad-ops", ["meta-tools"], ["pipeboard-meta"]),
      a("ad-spend-watcher", ["meta-tools"], ["pipeboard-meta"]),
    ]);
    assert(ws.length === 1, "exactly one warning");
    assert(ws[0]!.pair[0] === "ad-ops" && ws[0]!.pair[1] === "ad-spend-watcher", "pair carries both agent keys");
    assert(ws[0]!.sharedConnectors.includes("pipeboard-meta"), "shared connector listed");
    assert(ws[0]!.sharedSkills.includes("meta-tools"), "shared skill listed");
    assert(ws[0]!.message.includes("overlap:"), "message reads as a warning");
    assert(ws[0]!.message.includes("docs/agent-coordination-guidelines.md"), "message links the guidelines doc");
  }

  console.log("\n[detectArchitectOverlap — N agents, all-pair scan]");
  {
    const ws = detectArchitectOverlap([
      a("a", ["s"], ["c"]),
      a("b", ["s"], ["c"]),
      a("d", ["s"], ["c"]),
    ]);
    // (a,b), (a,d), (b,d) — three pairs.
    assert(ws.length === 3, "three pairs flagged for three fully-overlapping agents");
  }

  console.log("\n[detectArchitectOverlap — empty + single-agent inputs]");
  assert(detectArchitectOverlap([]).length === 0, "empty fleet → no warnings");
  assert(detectArchitectOverlap([a("solo", ["s"], ["c"])]).length === 0, "single agent → no warnings");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
