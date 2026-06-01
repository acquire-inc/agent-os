// Pure unit test for the metering/credit math. No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/metering.test.ts
import { computeUsage, classifyBalance, runGateDecision, DEFAULT_BILLING } from "./metering.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function main() {
  // ── at-cost (internal Acqu): markup 1.0, $1/credit ──
  const atCost = computeUsage(0.01, DEFAULT_BILLING);
  assert(close(atCost.billableUsd, 0.01), "at-cost: billable = raw");
  assert(close(atCost.credits, 0.01), "at-cost: credits = billable / $1");

  // ── resale: markup 1.5 → +50% margin ──
  const resale = computeUsage(0.01, { markupMultiple: 1.5, usdPerCredit: 1.0 });
  assert(close(resale.billableUsd, 0.015), "resale 1.5×: billable = raw × 1.5");
  assert(close(resale.credits, 0.015), "resale: credits track billable");

  // ── credit peg: $0.10/credit means 10 credits per billable dollar ──
  const peg = computeUsage(2.0, { markupMultiple: 1.0, usdPerCredit: 0.1 });
  assert(close(peg.billableUsd, 2.0), "peg: billable unaffected by peg");
  assert(close(peg.credits, 20.0), "peg: $2 / $0.10 = 20 credits");

  // ── rounding to 4dp (matches numeric column scale) ──
  const r = computeUsage(0.000123456, { markupMultiple: 2, usdPerCredit: 1 });
  assert(r.billableUsd === 0.0002, "billable rounds to 4dp");

  // ── defensive clamps ──
  assert(computeUsage(-5).credits === 0, "negative raw cost clamps to 0");
  assert(computeUsage(NaN).billableUsd === 0, "NaN raw cost clamps to 0");
  assert(close(computeUsage(0.01, { markupMultiple: 0, usdPerCredit: 0 }).credits, 0.01), "bad cfg falls back to 1.0/1.0");

  // ── balance classification ──
  assert(classifyBalance(10) === "ok", "positive balance ok");
  assert(classifyBalance(0.5) === "low", "below threshold = low");
  assert(classifyBalance(0) === "empty", "zero = empty");
  assert(classifyBalance(-3) === "empty", "negative = empty");
  assert(classifyBalance(5, 10) === "low", "custom threshold respected");

  // ── run gate: only prepaid tenants are blocked, and only when depleted ──
  assert(runGateDecision(false, 0).allowed === true, "unenforced tenant always runs (internal Acqu)");
  assert(runGateDecision(false, -100).allowed === true, "unenforced tenant runs even negative");
  assert(runGateDecision(true, 5).allowed === true, "prepaid with balance runs");
  assert(runGateDecision(true, 0).allowed === false, "prepaid at zero is blocked");
  assert(typeof runGateDecision(true, 0).reason === "string", "blocked gate carries a reason");
  assert(runGateDecision(true, -1).allowed === false, "prepaid negative is blocked");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
