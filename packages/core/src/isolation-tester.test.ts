// Pure test for the tenant-isolation evaluator (tool behind tenant-isolation-tester, Gate 2). No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/isolation-tester.test.ts
import { evaluateIsolation, TENANT_SCOPED_TABLES } from "./isolation-tester.js";

let passed = 0, failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const allClean = TENANT_SCOPED_TABLES.map((t) => ({ table: t, rowsVisibleCrossTenant: 0 }));

function main() {
  // ── full clean sweep → PASS ──
  const ok = evaluateIsolation(allClean);
  assert(ok.pass && ok.decision === "pass", "zero cross-tenant rows on every table → PASS");
  assert(/zero rows/.test(ok.summary), "summary states zero rows");

  // ── a leak → BLOCK P0, named ──
  const leak = evaluateIsolation(allClean.map((p) => (p.table === "run_summaries" ? { ...p, rowsVisibleCrossTenant: 3 } : p)));
  assert(!leak.pass && leak.decision === "block", "any cross-tenant leak → BLOCK");
  assert(leak.leaks.length === 1 && leak.leaks[0]!.table === "run_summaries", "the leaking table is named");
  assert(/P0/.test(leak.summary) && /run_summaries\(3\)/.test(leak.summary), "summary flags P0 + the leak count");

  // ── an UNPROBED required table → not a pass (can't claim isolation you didn't test) ──
  const partial = evaluateIsolation(allClean.filter((p) => p.table !== "usage_events"));
  assert(!partial.pass && partial.unprobed.includes("usage_events"), "an unprobed required table fails the gate");

  // ── newer (0009/0010) tables are in the required set (the historically under-audited ones) ──
  for (const t of ["usage_events", "credit_ledger", "tenant_credits", "run_summaries"]) {
    assert((TENANT_SCOPED_TABLES as readonly string[]).includes(t), `required set covers ${t}`);
  }

  // ── leak ranking: worst-first ──
  const multi = evaluateIsolation([
    ...allClean.filter((p) => p.table !== "runs" && p.table !== "documents"),
    { table: "runs", rowsVisibleCrossTenant: 2 },
    { table: "documents", rowsVisibleCrossTenant: 9 },
  ]);
  assert(multi.leaks[0]!.table === "documents" && multi.leaks[1]!.table === "runs", "leaks sorted by rows desc");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
