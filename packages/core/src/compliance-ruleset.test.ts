// Pure test for the ad-claim compliance ruleset (the tool behind ad-claim-compliance, Gate 1). No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/compliance-ruleset.test.ts
import { evaluateClaim, complianceVerdict, COMPLIANCE_RULES } from "./compliance-ruleset.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
const ids = (t: string) => evaluateClaim(t).violations.map((v) => v.ruleId);

function main() {
  // ── the seeded eval scenarios ──
  const bad = evaluateClaim("Guaranteed to 10x your revenue in 30 days or your money back.");
  assert(bad.decision === "block" && !bad.pass, "the seeded bad ad BLOCKS");
  assert(ids("Guaranteed to 10x your revenue in 30 days or your money back.").includes("multiplier-claim"), "catches the '10x' multiplier");
  assert(ids("Guaranteed to 10x your revenue in 30 days or your money back.").includes("guaranteed-outcome"), "catches the guaranteed outcome");

  const clean = evaluateClaim("We help roofing companies book more qualified estimates.");
  assert(clean.pass && clean.decision === "pass" && clean.violations.length === 0, "the seeded clean ad PASSES");

  // ── a real money-back guarantee is allowed (no outcome term) ──
  const refund = evaluateClaim("Try it with our 30-day money-back guarantee.");
  assert(refund.pass, "'money-back guarantee' alone does NOT block");
  assert(evaluateClaim("100% satisfaction guarantee on every order.").violations.every((v) => v.ruleId !== "guaranteed-outcome"), "'satisfaction guarantee' is not an outcome guarantee");

  // ── income / health / risk claims block ──
  assert(evaluateClaim("Make $10,000 per month from home.").decision === "block", "per-period income claim blocks");
  assert(evaluateClaim("You will earn $5000 with this system.").decision === "block", "earnings claim blocks");
  assert(evaluateClaim("Cure your anxiety in one session.").decision === "block", "health/cure claim blocks");
  assert(evaluateClaim("Lose 20 pounds in two weeks.").decision === "block", "weight-loss claim blocks");
  assert(evaluateClaim("Completely risk-free trial!").decision === "block", "'risk-free' blocks");
  assert(evaluateClaim("Our service is 100% effective.").decision === "block", "absolute effectiveness blocks");

  // ── warnings (review, don't auto-block) ──
  const sup = evaluateClaim("We're the #1 agency for roofers.");
  assert(sup.pass && sup.warnings === 1 && ids("We're the #1 agency for roofers.").includes("superlative"), "superlative warns but passes");
  const fast = evaluateClaim("See results overnight.");
  assert(fast.pass && fast.warnings >= 1, "unrealistic timeframe warns");

  // ── false-positive guards ──
  assert(!ids("Open 24x7 support for roofing clients.").includes("multiplier-claim"), "'24x7' is not a multiplier claim");
  assert(evaluateClaim("Book more estimates and grow your pipeline.").pass, "ordinary benefit copy passes clean");

  // ── verdict strings + engine integrity ──
  assert(/BLOCK/.test(complianceVerdict(bad)) && /PASS/.test(complianceVerdict(clean)), "verdict reflects the decision");
  assert(COMPLIANCE_RULES.every((r) => r.pattern instanceof RegExp && r.severity), "every rule is well-formed");

  // ── ReDoS / size guard: huge input still returns fast ──
  const huge = "a ".repeat(200_000) + "guaranteed results";
  const t0 = Date.now();
  evaluateClaim(huge);
  assert(Date.now() - t0 < 500, "large input evaluated within the size guard (no ReDoS)");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
