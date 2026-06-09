// Pure test for the ad rules engine (tool.4). No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/ad-rules.test.ts
import { evaluateAdset, evaluateAdRules } from "./ad-rules.js";
import { runCustomTool } from "./custom-tools.js";

let passed = 0, failed = 0;
const assert = (c: unknown, m: string) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };

// learning window → hold, no approval
const learn = evaluateAdset({ name: "M1", cpa: 80, targetCpa: 40, spend: 20, conversions: 1, daysRunning: 1 });
assert(learn.color === "yellow" && learn.action === "hold" && !learn.requiresApproval, "learning window → hold (don't judge yet)");

// green (at/under target) → propose scale (irreversible spend → approval)
const green = evaluateAdset({ name: "M2", cpa: 35, targetCpa: 40, spend: 300, conversions: 9, daysRunning: 5 });
assert(green.color === "green" && green.action === "scale" && green.requiresApproval, "under target → propose scale (approval)");

// yellow (slightly over) → hold
const yellow = evaluateAdset({ name: "M3", cpa: 48, targetCpa: 40, spend: 300, conversions: 6, daysRunning: 4 });
assert(yellow.color === "yellow" && yellow.action === "hold", "≤1.3x target → hold/watch");

// red (2x over, sustained) → propose pause (the seeded ad-ops eval scenario)
const red = evaluateAdset({ name: "M3", cpa: 80, targetCpa: 40, spend: 400, conversions: 5, daysRunning: 3 });
assert(red.color === "red" && red.action === "pause" && red.requiresApproval, "2x over target 3d → propose pause (not auto-execute)");

// 1.3x..2x over → cut budget (less drastic than pause)
const cut = evaluateAdset({ name: "M4", cpa: 64, targetCpa: 40, spend: 300, conversions: 6, daysRunning: 4 });
assert(cut.color === "red" && cut.action === "cut", "1.6x over → propose cut, not pause");

// batch report + dispatch (pass perf inputs, not the evaluated results)
const rep = evaluateAdRules([
  { name: "M2", cpa: 35, targetCpa: 40, spend: 300, conversions: 9, daysRunning: 5 }, // green→scale (proposal)
  { name: "M3", cpa: 80, targetCpa: 40, spend: 400, conversions: 5, daysRunning: 3 }, // red→pause (proposal)
  { name: "M5", cpa: 48, targetCpa: 40, spend: 300, conversions: 6, daysRunning: 4 }, // yellow→hold (no proposal)
]);
assert(rep.proposals.length === 2 && rep.results.length === 3 && /green/.test(rep.summary), "batch surfaces only the irreversible proposals + summary");
void green; void red;
const viaDispatch = runCustomTool("tool.4", { adsets: [{ name: "M3", cpa: 80, targetCpa: 40, spend: 400, conversions: 5, daysRunning: 3 }] });
assert(viaDispatch.ok && (viaDispatch.result as { proposals: unknown[] }).proposals.length === 1, "runs through runCustomTool(tool.4)");

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
