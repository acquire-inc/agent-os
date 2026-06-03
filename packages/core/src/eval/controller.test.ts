// Controller tests.
// Run: pnpm --filter @agent-os/core test:controller

import { computeNextAutonomy, type Autonomy } from "./controller.js";
import type { Verdict } from "./scorecard.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const NON_CANT_FAIL = false;
const CANT_FAIL = true;

function check(
  current: Autonomy,
  verdict: Verdict,
  isCantFail: boolean,
  expectedNext: Autonomy,
  expectedChanged: boolean,
) {
  const decision = computeNextAutonomy(current, verdict, isCantFail);
  const ok =
    decision.nextAutonomy === expectedNext && decision.changed === expectedChanged;
  assert(
    ok,
    `${current} + ${verdict}${isCantFail ? " (cant-fail)" : ""} → ${decision.nextAutonomy} (changed=${decision.changed}); expected ${expectedNext} (changed=${expectedChanged})`,
  );
}

function main() {
  console.log("• Group 1 — promote walks up the ladder");
  check("propose", "promote", NON_CANT_FAIL, "execute_safe", true);
  check("execute_safe", "promote", NON_CANT_FAIL, "execute_full", true);
  check("execute_full", "promote", NON_CANT_FAIL, "execute_full", false); // ceiling

  console.log("\n• Group 2 — demote walks down the ladder");
  check("execute_full", "demote", NON_CANT_FAIL, "execute_safe", true);
  check("execute_safe", "demote", NON_CANT_FAIL, "propose", true);
  check("propose", "demote", NON_CANT_FAIL, "propose", false); // floor

  console.log("\n• Group 3 — force_demote_safety pulls to propose (unconditional)");
  check("execute_full", "force_demote_safety", NON_CANT_FAIL, "propose", true);
  check("execute_safe", "force_demote_safety", NON_CANT_FAIL, "propose", true);
  check("propose", "force_demote_safety", NON_CANT_FAIL, "propose", false);
  // Even cant-fail agents that drifted up get pulled back.
  check("execute_full", "force_demote_safety", CANT_FAIL, "propose", true);
  check("execute_safe", "force_demote_safety", CANT_FAIL, "propose", true);

  console.log("\n• Group 4 — hold and insufficient_data are no-ops");
  check("execute_safe", "hold", NON_CANT_FAIL, "execute_safe", false);
  check("execute_safe", "insufficient_data", NON_CANT_FAIL, "execute_safe", false);
  check("propose", "hold", NON_CANT_FAIL, "propose", false);

  console.log("\n• Group 5 — cant-fail agents cannot promote past execute_safe");
  // propose → execute_safe is allowed for cant-fail
  check("propose", "promote", CANT_FAIL, "execute_safe", true);
  // execute_safe → execute_full is BLOCKED for cant-fail; stays at execute_safe.
  check("execute_safe", "promote", CANT_FAIL, "execute_safe", false);
  // execute_full → execute_full is unchanged (already at ceiling, but
  // controller still caps to execute_safe for cant-fail — surfacing a
  // bug if a cant-fail agent ever landed at execute_full).
  check("execute_full", "promote", CANT_FAIL, "execute_safe", true);

  console.log("\n• Group 6 — unknown current autonomy biases to propose floor");
  const decision = computeNextAutonomy("invalid_autonomy" as Autonomy, "promote", NON_CANT_FAIL);
  assert(decision.nextAutonomy === "propose", "unknown autonomy → propose");
  assert(decision.changed === true, "unknown autonomy → changed=true");
  assert(
    decision.rationale.includes("unknown"),
    "rationale mentions unknown autonomy",
  );

  console.log("\n• Group 7 — rationale is non-empty for every verdict");
  for (const v of [
    "promote",
    "hold",
    "demote",
    "force_demote_safety",
    "insufficient_data",
  ] as Verdict[]) {
    const d = computeNextAutonomy("execute_safe", v, NON_CANT_FAIL);
    assert(d.rationale.length > 0, `verdict=${v} has non-empty rationale`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
