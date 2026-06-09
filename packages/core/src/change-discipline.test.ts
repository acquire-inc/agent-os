// Pure test for the one-change-per-day enforcer (tool.5). No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/change-discipline.test.ts
import { enforceChangeLimit } from "./change-discipline.js";
import { runCustomTool } from "./custom-tools.js";

let passed = 0, failed = 0;
const assert = (c: unknown, m: string) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const NOW = "2026-06-09T15:00:00Z";

// entity changed earlier TODAY → blocked
const r1 = enforceChangeLimit(
  [{ entityId: "M3", entityName: "Adset M3", action: "pause" }],
  [{ entityId: "M3", changedAt: "2026-06-09T08:00:00Z" }],
  { now: NOW },
);
assert(r1.allowed.length === 0 && r1.blocked.length === 1, "entity changed today → held");
assert(/already changed today/.test(r1.blocked[0]!.reason), "block reason names the rule");

// entity last changed YESTERDAY → allowed
const r2 = enforceChangeLimit(
  [{ entityId: "M3", action: "cut" }],
  [{ entityId: "M3", changedAt: "2026-06-08T23:00:00Z" }],
  { now: NOW },
);
assert(r2.allowed.length === 1 && r2.blocked.length === 0, "yesterday's change doesn't block today");

// two proposals for the SAME entity in one batch → first allowed, second held
const r3 = enforceChangeLimit(
  [{ entityId: "M3", action: "cut" }, { entityId: "M3", action: "pause" }, { entityId: "M7", action: "scale" }],
  [],
  { now: NOW },
);
assert(r3.allowed.length === 2 && r3.blocked.length === 1, "in-batch duplicate for an entity is held; distinct entities pass");
assert(r3.allowed.some((p) => p.entityId === "M7"), "a different entity is still allowed");

// dispatch via runCustomTool
const d = runCustomTool("tool.5", { proposals: [{ entityId: "M3", action: "pause" }], history: [{ entityId: "M3", changedAt: NOW }], now: NOW });
assert(d.ok && (d.result as { blocked: unknown[] }).blocked.length === 1, "runs through runCustomTool(tool.5)");

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
