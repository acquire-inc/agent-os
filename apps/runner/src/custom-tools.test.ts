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
      id: "agent-id", tenantId: "tenant-id",
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
    [{ key: "tool.browser", name: "Browser", kind: "custom", inputSchema: {}, requiresApproval: true, reversible: false, costEstimateUsd: "0" }],
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
      bundle([{ key: "tool.unknown", name: "X", kind: "custom", inputSchema: {}, requiresApproval: true, reversible: false, costEstimateUsd: "0" }]),
      "tool.unknown",
      {},
    ),
    "no custom-tool handler",
    "refuses dispatch when no handler is registered for the key",
  );

  console.log("• customToolDispatch registry");
  assert(typeof customToolDispatch["tool.browser"] === "function", "tool.browser handler is registered");

  // Phase 26: reserve-before / commit-after wrapping + CapBreachError.
  console.log("• Phase 26: dispatchCustomTool reserves before invoking the handler");
  {
    const { CapBreachError } = await import("./custom-tools.js");
    const { getBudgetTracker, resetBudgetTrackerForTests } = await import("./budget.js");

    // Register a no-op test handler so the dispatcher actually runs.
    const handlerRan = { count: 0 };
    customToolDispatch["tool.test-reserve"] = async () => {
      handlerRan.count++;
      return { result: { ok: true } };
    };

    try {
      // Case 1: tracker has a run, cap=$1.00, tool estimate=$0.30 -> commit ok.
      resetBudgetTrackerForTests();
      const tracker = getBudgetTracker();
      tracker.openRun("phase26-run-A", 1.0);
      const bundleA = bundle(
        [{ key: "tool.test-reserve", name: "Test", kind: "custom", inputSchema: {}, requiresApproval: false, reversible: true, costEstimateUsd: "0.30" }],
      );
      bundleA.run.id = "phase26-run-A";
      await dispatchCustomTool(bundleA, "tool.test-reserve", {});
      const snapA = tracker.snapshot("phase26-run-A");
      assert(snapA?.committedTotal === 0.3, "successful dispatch committed the estimate");
      assert(handlerRan.count === 1, "handler ran exactly once");

      // Case 2: cap=$0.10, tool estimate=$0.30 -> CapBreachError, no handler run.
      resetBudgetTrackerForTests();
      const trackerB = getBudgetTracker();
      trackerB.openRun("phase26-run-B", 0.1);
      handlerRan.count = 0;
      const bundleB = bundle(
        [{ key: "tool.test-reserve", name: "Test", kind: "custom", inputSchema: {}, requiresApproval: false, reversible: true, costEstimateUsd: "0.30" }],
      );
      bundleB.run.id = "phase26-run-B";
      let threw = false;
      try {
        await dispatchCustomTool(bundleB, "tool.test-reserve", {});
      } catch (e) {
        threw = e instanceof CapBreachError;
      }
      assert(threw, "dispatchCustomTool threw CapBreachError when reserve breaches cap");
      assert(handlerRan.count === 0, "handler did NOT run on cap-breach refusal");

      // Case 3: tracker has no open run -> skip reserve/commit silently, handler runs.
      resetBudgetTrackerForTests();
      handlerRan.count = 0;
      const bundleC = bundle(
        [{ key: "tool.test-reserve", name: "Test", kind: "custom", inputSchema: {}, requiresApproval: false, reversible: true, costEstimateUsd: "0.30" }],
      );
      bundleC.run.id = "phase26-run-C-no-tracker";
      await dispatchCustomTool(bundleC, "tool.test-reserve", {});
      assert(handlerRan.count === 1, "no-tracker path still invokes handler");

      // Case 4: handler throws -> reservation is released.
      resetBudgetTrackerForTests();
      const trackerD = getBudgetTracker();
      trackerD.openRun("phase26-run-D", 1.0);
      customToolDispatch["tool.test-reserve-throw"] = async () => {
        throw new Error("handler failed");
      };
      const bundleD = bundle(
        [{ key: "tool.test-reserve-throw", name: "Test", kind: "custom", inputSchema: {}, requiresApproval: false, reversible: true, costEstimateUsd: "0.40" }],
      );
      bundleD.run.id = "phase26-run-D";
      let handlerThrew = false;
      try {
        await dispatchCustomTool(bundleD, "tool.test-reserve-throw", {});
      } catch {
        handlerThrew = true;
      }
      assert(handlerThrew, "handler error propagates");
      const snapD = trackerD.snapshot("phase26-run-D");
      assert(snapD?.committedTotal === 0, "no commit on handler failure");
      assert(snapD?.releasedTotal === 0.4, "reservation was released back to the pool");
    } finally {
      delete customToolDispatch["tool.test-reserve"];
      delete customToolDispatch["tool.test-reserve-throw"];
    }
  }

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
