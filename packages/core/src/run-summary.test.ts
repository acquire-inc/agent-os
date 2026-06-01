// Pure test for the run-summary contract parser. No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/run-summary.test.ts
import { parseRunSummary } from "./run-summary.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  // ── empty / null → all-empty contract ──
  const empty = parseRunSummary(null);
  assert(empty.whatIDid === "" && empty.whatNext === "", "null → all-empty contract");
  assert(parseRunSummary("   ").whatIDid === "", "whitespace → empty");

  // ── unlabeled text → everything is what_i_did (never lose content) ──
  const plain = parseRunSummary("Posted the morning vitals snapshot to #vitals.");
  assert(plain.whatIDid === "Posted the morning vitals snapshot to #vitals.", "unlabeled → what_i_did");
  assert(plain.whatIProduced === "", "unlabeled → other fields empty");

  // ── fully labeled, inline values ──
  const labeled = parseRunSummary(
    [
      "What I did: Pulled 3 days of insights and ran the rules engine.",
      "What I produced: kb:campaign-plan/acqu/proposals-2026-06-01.md",
      "What I learned: M3 adset CPA is 2x target for 3 days.",
      "What's next: Propose a pause once it clears the 3-day floor.",
      "Verification: rule-engine + change-per-day linter passed.",
    ].join("\n"),
  );
  assert(labeled.whatIDid.includes("rules engine"), "what_i_did parsed");
  assert(labeled.whatIProduced.includes("proposals-2026-06-01.md"), "what_i_produced parsed (a path, not a blob)");
  assert(labeled.whatILearned.includes("2x target"), "what_i_learned parsed");
  assert(labeled.whatNext.includes("pause"), "what_next parsed");
  assert(labeled.verificationResult.includes("linter passed"), "verification parsed");

  // ── header phrasing variants ──
  const variant = parseRunSummary("Did: x\nOutput: y\nLearnings: z\nNext steps: w\nVerified: ok");
  assert(variant.whatIDid === "x", "'Did:' → what_i_did");
  assert(variant.whatIProduced === "y", "'Output:' → what_i_produced");
  assert(variant.whatILearned === "z", "'Learnings:' → what_i_learned");
  assert(variant.whatNext === "w", "'Next steps:' → what_next");
  assert(variant.verificationResult === "ok", "'Verified:' → verification");

  // ── multi-line section accumulates until the next header ──
  const multi = parseRunSummary("What I did:\n- step one\n- step two\nWhat's next: ship it");
  assert(multi.whatIDid.includes("step one") && multi.whatIDid.includes("step two"), "multi-line section accumulates");
  assert(multi.whatNext === "ship it", "next header ends the previous section");

  // ── preamble before any header → what_i_did ──
  const pre = parseRunSummary("Quick run.\nWhat's next: nothing");
  assert(pre.whatIDid === "Quick run.", "preamble → what_i_did");
  assert(pre.whatNext === "nothing", "labeled section after preamble still parses");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
