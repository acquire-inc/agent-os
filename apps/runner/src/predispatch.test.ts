// predispatch.test.ts — Wave D: the PreToolUse hook fires onDispatch (the
// tool.dispatched emitter) ONLY on the allow path, before returning allow.
// On propose/deny paths it must NOT fire (those are approval.requested /
// autonomy.denied events, not dispatches).
//
// Run: pnpm --filter @agent-os/runner test:predispatch
//
// No live model, no live DB — onDispatch is a spy.

import { buildPreToolUseHook } from "./hooks.js";
import type { ApiClient } from "./api-client.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function makeApi() {
  return {
    postApproval: async () => undefined,
    postAutonomyEvent: async () => undefined,
    postAudit: async () => undefined,
  } as unknown as ApiClient;
}

async function main() {
  console.log("• allow path → onDispatch fires once with the tool name");
  const dispatched: string[] = [];
  const allowHook = buildPreToolUseHook(makeApi(), "run-1", {
    autonomy: "execute_full", // execute_full → reversible + irreversible both allowed
    escalationPolicy: null,
    agentName: "Test",
    onDispatch: async (toolName) => { dispatched.push(toolName); },
  });
  const allowDecision = await allowHook({ tool_name: "Read" });
  assert(allowDecision.decision === "allow", "decision is allow");
  assert(dispatched.length === 1 && dispatched[0] === "Read", "onDispatch fired once with 'Read'");

  console.log("• propose path → onDispatch does NOT fire (it's an approval, not a dispatch)");
  const proposeDispatched: string[] = [];
  const proposeHook = buildPreToolUseHook(makeApi(), "run-1", {
    autonomy: "propose", // propose → irreversible tools get raised for approval
    escalationPolicy: null,
    agentName: "Test",
    onDispatch: async (toolName) => { proposeDispatched.push(toolName); },
  });
  // A write/irreversible tool under autonomy=propose routes to 'ask'.
  const proposeDecision = await proposeHook({ tool_name: "Bash" });
  assert(proposeDecision.decision === "ask" || proposeDecision.decision === "deny", `non-allow decision (got ${proposeDecision.decision})`);
  assert(proposeDispatched.length === 0, "onDispatch did NOT fire on the non-allow path");

  console.log("• allow path with no onDispatch wired → no throw (optional callback)");
  const noCbHook = buildPreToolUseHook(makeApi(), "run-1", {
    autonomy: "execute_full",
    escalationPolicy: null,
    agentName: "Test",
    // onDispatch intentionally omitted
  });
  const noCbDecision = await noCbHook({ tool_name: "Read" });
  assert(noCbDecision.decision === "allow", "allow still returned when onDispatch is undefined");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
