// Run-state tests — autonomy ratchet behavior.
// Run: pnpm --filter @agent-os/runner test:run-state

import {
  clearRunState,
  effectiveAutonomy,
  getAutonomyOverride,
  getRatchetReasons,
  ratchetAutonomy,
  resetAllRunStateForTests,
} from "./run-state.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const RUN = "run-state-1";

async function main() {
  console.log("• Group 1 — no override -> effectiveAutonomy returns fallback");
  resetAllRunStateForTests();
  assert(getAutonomyOverride(RUN) === null, "no override yet");
  assert(effectiveAutonomy(RUN, "execute_safe") === "execute_safe", "fallback returned");

  console.log("\n• Group 2 — ratchet down sets override");
  ratchetAutonomy(RUN, "propose", "injection detected");
  assert(getAutonomyOverride(RUN) === "propose", "override = propose");
  assert(effectiveAutonomy(RUN, "execute_safe") === "propose", "effective ignores fallback");
  assert(getRatchetReasons(RUN).length === 1, "one reason recorded");
  assert(
    getRatchetReasons(RUN)[0]?.includes("injection"),
    "reason names the trigger",
  );

  console.log("\n• Group 3 — ratchet only goes DOWN");
  ratchetAutonomy(RUN, "execute_safe", "later upgrade attempt");
  assert(getAutonomyOverride(RUN) === "propose", "override stays at propose (no upgrade)");
  assert(getRatchetReasons(RUN).length === 1, "reason NOT added (no-op)");

  ratchetAutonomy(RUN, "execute_full", "another upgrade attempt");
  assert(getAutonomyOverride(RUN) === "propose", "still propose");
  assert(getRatchetReasons(RUN).length === 1, "still one reason");

  console.log("\n• Group 4 — multiple legitimate ratchets accumulate reasons");
  resetAllRunStateForTests();
  ratchetAutonomy(RUN, "execute_safe", "first downgrade from execute_full");
  ratchetAutonomy(RUN, "propose", "second downgrade to propose");
  assert(getAutonomyOverride(RUN) === "propose", "final override = propose");
  assert(getRatchetReasons(RUN).length === 2, "two reasons recorded");

  console.log("\n• Group 5 — clearRunState frees state");
  await clearRunState(RUN);
  assert(getAutonomyOverride(RUN) === null, "override cleared");
  assert(getRatchetReasons(RUN).length === 0, "reasons cleared");
  assert(effectiveAutonomy(RUN, "execute_safe") === "execute_safe", "fallback returned after clear");

  console.log("\n• Group 6 — independent runs do not affect each other");
  resetAllRunStateForTests();
  ratchetAutonomy("run-A", "propose", "A reason");
  ratchetAutonomy("run-B", "execute_safe", "B reason");
  assert(getAutonomyOverride("run-A") === "propose", "run A at propose");
  assert(getAutonomyOverride("run-B") === "execute_safe", "run B at execute_safe");
  await clearRunState("run-A");
  assert(getAutonomyOverride("run-A") === null, "run A cleared");
  assert(getAutonomyOverride("run-B") === "execute_safe", "run B unchanged");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
