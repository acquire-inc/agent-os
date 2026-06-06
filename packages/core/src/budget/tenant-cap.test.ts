// Phase 53 tests: tenant monthly cost cap math.
// Run: pnpm --filter @agent-os/core test:tenant-cap

import { checkTenantBudget } from "./tenant-cap.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

async function main() {
  console.log("• Group 1 — null cap (no monthly budget set): always ok");
  {
    const r = checkTenantBudget({ monthlyBudgetUsd: null, monthToDateUsd: 1000, forecastUsd: 50 });
    assert(r.ok === true, "ok=true with no cap");
    assert(r.capUsd === null, "capUsd=null");
    assert(r.remainingUsd === Number.POSITIVE_INFINITY, "remainingUsd=Infinity");
  }

  console.log("\n• Group 2 — fresh month (mtd=0) well under cap");
  {
    const r = checkTenantBudget({ monthlyBudgetUsd: 100, monthToDateUsd: 0, forecastUsd: 5 });
    assert(r.ok === true, "ok=true");
    assert(r.remainingUsd === 95, "remainingUsd=95");
    assert(r.percentUsed === 5, "percentUsed=5");
    assert(r.reason === undefined, "no warning below threshold");
  }

  console.log("\n• Group 3 — projected = cap exactly: ok=true, percentUsed=100");
  {
    const r = checkTenantBudget({ monthlyBudgetUsd: 100, monthToDateUsd: 95, forecastUsd: 5 });
    assert(r.ok === true, "ok=true at exactly cap");
    assert(r.remainingUsd === 0, "remainingUsd=0");
    assert(r.percentUsed === 100, "percentUsed=100");
    assert(r.reason?.includes("WARN") === true, "warning fires at 100% (>=90% default)");
  }

  console.log("\n• Group 4 — projected exceeds cap: ok=false");
  {
    const r = checkTenantBudget({ monthlyBudgetUsd: 100, monthToDateUsd: 98, forecastUsd: 5 });
    assert(r.ok === false, "ok=false on breach");
    assert(r.remainingUsd === -3, "remainingUsd=-3");
    assert(r.reason?.includes("exceeds monthly cap"), `reason names breach (got: ${r.reason})`);
  }

  console.log("\n• Group 5 — already over cap with no forecast");
  {
    const r = checkTenantBudget({ monthlyBudgetUsd: 100, monthToDateUsd: 150 });
    assert(r.ok === false, "ok=false when mtd > cap");
    assert(r.remainingUsd === -50, "remainingUsd=-50");
    assert(r.percentUsed === 100, "percentUsed capped at 100");
  }

  console.log("\n• Group 6 — warning at 80% with custom threshold");
  {
    const r = checkTenantBudget({
      monthlyBudgetUsd: 100,
      monthToDateUsd: 75,
      forecastUsd: 5,
      warnPercentage: 75,
    });
    assert(r.ok === true, "ok=true");
    assert(r.percentUsed === 80, "percentUsed=80");
    assert(r.reason?.startsWith("WARN"), "warning fires at custom 75% threshold");
  }

  console.log("\n• Group 7 — zero cap rejects all spend");
  {
    const r = checkTenantBudget({ monthlyBudgetUsd: 0, monthToDateUsd: 0, forecastUsd: 0.001 });
    assert(r.ok === false, "ok=false with $0 cap");
    assert(r.reason?.includes("no spend allowed"), `reason names zero cap (got: ${r.reason})`);
  }

  console.log("\n• Group 8 — no forecast provided defaults to 0");
  {
    const r = checkTenantBudget({ monthlyBudgetUsd: 100, monthToDateUsd: 50 });
    assert(r.ok === true, "ok=true");
    assert(r.projectedAfterRunUsd === 50, "projected = mtd when forecast missing");
    assert(r.remainingUsd === 50, "remaining = 50");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
