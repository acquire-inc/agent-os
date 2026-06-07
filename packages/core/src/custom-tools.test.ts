// Pure test for the custom-tool dispatcher. No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/custom-tools.test.ts
import { runCustomTool, isImplementedTool, IMPLEMENTED_TOOL_KEYS } from "./custom-tools.js";

let passed = 0, failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  assert(isImplementedTool("tool.compliance-ruleset") && !isImplementedTool("tool.billing-engine"), "knows implemented vs stub tools");

  // compliance routes to the real evaluator (string or {text})
  const c = runCustomTool("tool.compliance-ruleset", { text: "Guaranteed to 10x your revenue." });
  assert(c.ok && (c.result as { decision: string }).decision === "block", "compliance-ruleset runs + blocks a bad claim");
  assert((runCustomTool("tool.compliance-ruleset", "We help roofers book estimates.").result as { pass: boolean }).pass, "accepts a raw-string input too");

  // voice-lint routes to the linter
  const v = runCustomTool("tool.voice-lint", { text: "We leverage synergy to delve into your funnel." });
  assert(v.ok && Array.isArray(v.result) && (v.result as unknown[]).length > 0, "voice-lint runs + flags banned phrases");

  // isolation routes with probes
  const i = runCustomTool("tool.isolation-test-suite", { probes: [{ table: "runs", rowsVisibleCrossTenant: 4 }] });
  assert(i.ok && (i.result as { decision: string }).decision === "block", "isolation-test-suite runs + blocks a leak");

  // stub / unknown tool fails honestly (no fabricated result)
  const stub = runCustomTool("tool.billing-engine", {});
  assert(!stub.ok && /no implementation/.test(stub.error ?? ""), "a stub tool returns ok:false, not a fake result");
  assert(IMPLEMENTED_TOOL_KEYS.every((k) => runCustomTool(k, {}).ok), "every declared-implemented key actually dispatches");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
