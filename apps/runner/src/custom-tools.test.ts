// Unit tests for allowedTools derivation + custom-tool dispatch guard.
// No live model, no live network. Run: pnpm --filter @agent-os/runner test
import { deriveAllowedTools, dispatchCustomTool, customToolDispatch } from "./custom-tools.js";
import type { Bundle } from "./api-client.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}
async function assertRejects(fn: () => Promise<unknown>, match: string, msg: string) {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${msg} — expected rejection, resolved`);
  } catch (e) {
    if ((e as Error).message.includes(match)) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg} — wrong error: ${(e as Error).message}`);
    }
  }
}

function bundle(tools: Bundle["tools"], mcpServers: Bundle["mcpServers"] = []): Bundle {
  return {
    run: { id: "r1", status: "running", triggerSource: "test", scheduledFor: null, sdkSessionId: null },
    job: null,
    agent: {
      key: "test-agent", name: "Test", persona: null, backend: "claude-agent-sdk",
      model: "m", thinkingLevel: "low", autonomy: "propose",
      escalationPolicy: null, budgetCapUsd: null, runnerKind: "local",
    },
    skills: [],
    mcpServers,
    tools,
    knowledge: [],
    envVars: {},
    autonomy: "propose",
    api: { statusUrl: "", activityUrl: "", approvalsUrl: "", validStatuses: [] },
  };
}

async function main() {
  console.log("• deriveAllowedTools (Pitfall 5 — explicit allowlist)");
  const b = bundle(
    [{ key: "tool.browser", name: "Browser", kind: "custom", inputSchema: {}, requiresApproval: true, reversible: false }],
    [{ name: "Slack", transport: "http", endpoint: null, authType: "oauth", credentials: null }],
  );
  const allowed = deriveAllowedTools(b);
  assert(allowed.includes("tool.browser"), "includes bound tool key");
  assert(allowed.includes("Slack"), "includes bound MCP name");
  assert(deriveAllowedTools(bundle([])).length === 0, "empty when no tools/mcps bound (not a wildcard)");

  console.log("• dispatchCustomTool guard (defense in depth)");
  await assertRejects(
    () => dispatchCustomTool(bundle([]), "tool.browser", { url: "https://example.com", instruction: "x" }),
    "not bound",
    "refuses dispatch when agent lacks the tool binding",
  );
  await assertRejects(
    () => dispatchCustomTool(
      bundle([{ key: "tool.unknown", name: "X", kind: "custom", inputSchema: {}, requiresApproval: true, reversible: false }]),
      "tool.unknown",
      {},
    ),
    "no custom-tool handler",
    "refuses dispatch when no handler is registered for the key",
  );

  console.log("• customToolDispatch registry");
  assert(typeof customToolDispatch["tool.browser"] === "function", "tool.browser handler is registered");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
