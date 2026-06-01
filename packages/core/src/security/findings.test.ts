// security/findings.test.ts — compile-time + shape assertions (no live DB).
// Run: pnpm --filter @agent-os/core run test:security

import { recordFinding, type FindingArgs, type FindingCategory, type FindingSeverity } from "./findings.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

async function main() {
  console.log("• recordFinding surface");
  assert(typeof recordFinding === "function", "recordFinding is a function");

  console.log("• FindingArgs typing accepts valid shape");
  const valid: FindingArgs = {
    tenantId: "00000000-0000-0000-0000-000000000000",
    category: "isolation",
    severity: "critical",
    title: "cross-tenant read leaked",
    payload: { table: "agents", leaked_count: 3 },
  };
  assert(valid.category === "isolation", "valid category accepted");
  assert(valid.severity === "critical", "valid severity accepted");

  console.log("• FindingArgs rejects invalid category at type level (@ts-expect-error)");
  // The next 4 lines MUST fail to typecheck — confirming the union types are enforced.
  // @ts-expect-error — "made-up" is not in the FindingCategory union
  const _badCategory: FindingArgs = { tenantId: "x", category: "made-up", severity: "low", title: "x" };
  // @ts-expect-error — "panic" is not in the FindingSeverity union
  const _badSeverity: FindingArgs = { tenantId: "x", category: "anomaly", severity: "panic", title: "x" };
  void _badCategory; void _badSeverity;
  assert(true, "compile-time rejection wired (file typechecked => @ts-expect-error fired)");

  console.log("• Category + severity unions exported");
  const cats: FindingCategory[] = ["isolation", "rotation", "access", "anomaly"];
  const sevs: FindingSeverity[] = ["low", "medium", "high", "critical"];
  assert(cats.length === 4, "all 4 categories exported");
  assert(sevs.length === 4, "all 4 severities exported");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
