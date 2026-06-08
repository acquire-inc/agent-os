// Pure test for the connector-health evaluator (tool.connector-healthcheck). No DB.
// Run: pnpm --filter @agent-os/core exec tsx src/connector-health.test.ts
import { evaluateConnectorHealth } from "./connector-health.js";
import { runCustomTool } from "./custom-tools.js";

let passed = 0, failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function main() {
  // all healthy
  const ok = evaluateConnectorHealth([{ name: "Slack", status: "connected" }, { name: "Close", status: "connected" }]);
  assert(ok.allHealthy && ok.needsAttention.length === 0, "all connected → healthy");

  // the seeded scenario: Close 401 (needs_reauth) with dependents → propose reauth, named
  const r = evaluateConnectorHealth([
    { name: "Slack", status: "connected", dependents: 5 },
    { name: "Close", status: "needs_reauth", dependents: 4 },
  ]);
  assert(!r.allHealthy, "an unhealthy connector → needs attention");
  assert(r.needsAttention[0]!.name === "Close" && r.needsAttention[0]!.action === "reauth", "needs_reauth → propose reauth");
  assert(r.needsAttention[0]!.severity === "critical", "down WITH dependents is critical");
  assert(/Close→reauth \(4 agents\)/.test(r.summary), "summary names the connector + action + dependents");

  // severity ranking: critical (dependents) before warn (no dependents)
  const ranked = evaluateConnectorHealth([
    { name: "Notion", status: "disconnected", dependents: 0 },
    { name: "Stripe", status: "error", dependents: 3 },
  ]);
  assert(ranked.actions[0]!.name === "Stripe" && ranked.actions[0]!.severity === "critical", "critical (with dependents) ranks first");
  assert(ranked.actions[1]!.severity === "warn", "down with no dependents is a warning");
  assert(ranked.actions.find((a) => a.name === "Notion")!.action === "reconnect", "disconnected → reconnect");

  // dispatches via the custom-tool bridge
  const viaDispatch = runCustomTool("tool.connector-healthcheck", { connectors: [{ name: "Close", status: "needs_reauth", dependents: 1 }] });
  assert(viaDispatch.ok && !(viaDispatch.result as { allHealthy: boolean }).allHealthy, "runs through runCustomTool");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
