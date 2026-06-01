// Pure test for the can't-fail autonomy ceiling — the compensating control that makes the
// all-Hermes operator override safe for high-stakes agents. No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/autonomy-ceiling.test.ts
import { proposeAutonomyChange } from "./metrics.js";
import { isCantFailAgent, maxAutonomyForAgent, CANT_FAIL_AGENTS } from "@agent-os/shared";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const perfect = { runs: 30, successRate: 0.99, approvalRate: 0.99 };

function main() {
  // ── the list + helpers ──
  assert(isCantFailAgent("ad-claim-compliance"), "ad-claim-compliance is can't-fail");
  assert(isCantFailAgent("tenant-isolation-tester"), "tenant-isolation-tester is can't-fail");
  assert(isCantFailAgent("cliently.dev"), "code-writing agent is can't-fail");
  assert(!isCantFailAgent("vitals"), "vitals is NOT can't-fail");
  assert(!isCantFailAgent("ad-ops"), "ad-ops is NOT can't-fail");
  assert(CANT_FAIL_AGENTS.length === 14, "14 can't-fail agents (matches CLAUDE.md)");

  // ── the ceiling per agent ──
  assert(maxAutonomyForAgent("pricing-architect") === "propose", "can't-fail ceiling = propose");
  assert(maxAutonomyForAgent("vitals") === "execute_full", "non-can't-fail ceiling = execute_full");

  // ── promotion is blocked at the ceiling, regardless of how good the metrics are ──
  const capped = proposeAutonomyChange(perfect, {
    currentAutonomy: "propose",
    maxAutonomy: maxAutonomyForAgent("contract-drafter"),
  });
  assert(capped.action === "hold", "can't-fail agent with perfect scorecard → hold (not promote)");
  assert(capped.reason.includes("ceiling"), "hold reason names the ceiling");

  // ── a normal agent with the same scorecard DOES promote ──
  const promoted = proposeAutonomyChange(perfect, {
    currentAutonomy: "propose",
    maxAutonomy: maxAutonomyForAgent("vitals"),
  });
  assert(promoted.action === "promote", "normal agent with perfect scorecard → promote");

  // ── ceiling at execute_safe: can't go to execute_full ──
  const atSafe = proposeAutonomyChange(perfect, { currentAutonomy: "execute_safe", maxAutonomy: "execute_safe" });
  assert(atSafe.action === "hold", "agent already at its ceiling → hold");
  const belowSafe = proposeAutonomyChange(perfect, { currentAutonomy: "propose", maxAutonomy: "execute_safe" });
  assert(belowSafe.action === "promote", "below ceiling → promote (one rung)");

  // ── safety always wins: demotion is never blocked by the ceiling ──
  const demote = proposeAutonomyChange({ runs: 30, successRate: 0.5, approvalRate: 0.99 }, { currentAutonomy: "propose", maxAutonomy: "propose" });
  assert(demote.action === "demote", "ceiling never blocks demotion");

  // ── backward-compat: no ceiling args → original behavior ──
  assert(proposeAutonomyChange(perfect).action === "promote", "no ceiling args → promotes as before");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
