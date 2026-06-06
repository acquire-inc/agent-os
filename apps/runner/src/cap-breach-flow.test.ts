// Phase 36 integration test: per-tool cap-breach end-to-end.
//
// Asserts the dispatchCustomTool → CapBreachError chain when the
// per-tool reserve breaches the run's budgetCapUsd. Verifies:
//   - Handler does NOT run on cap breach
//   - CapBreachError is thrown with the correct fields
//   - Reservation tracker state matches the refusal
//   - Successful tool calls vs. breached ones don't cross-contaminate
//
// Note: the Approval emit (Phase 28) requires DATABASE_URL — we only
// verify the throw path here; the emit is best-effort and the throw
// fires either way.
//
// Run: pnpm --filter @agent-os/runner test:cap-breach-flow

import {
  CapBreachError,
  customToolDispatch,
  dispatchCustomTool,
} from "./custom-tools.js";
import { getBudgetTracker, resetBudgetTrackerForTests } from "./budget.js";
import type { Bundle } from "./api-client.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function bundle(opts: { capUsd: number; runId: string; toolCostUsd: string; toolKey: string }): Bundle {
  return {
    run: { id: opts.runId, status: "running", triggerSource: "test", scheduledFor: null, sdkSessionId: null },
    job: null,
    agent: {
      id: "agent-1", tenantId: "tenant-1", key: "test-agent", name: "Test",
      persona: null, backend: "claude-agent-sdk", model: "m",
      thinkingLevel: "low", autonomy: "execute_safe",
      escalationPolicy: null, budgetCapUsd: opts.capUsd, runnerKind: "local",
    },
    skills: [],
    mcpServers: [],
    tools: [{
      key: opts.toolKey,
      name: "Test Tool",
      kind: "custom",
      inputSchema: {},
      requiresApproval: false,
      reversible: true,
      costEstimateUsd: opts.toolCostUsd,
      preferredModelTier: null,
    }],
    knowledge: [],
    envVars: {},
    autonomy: "execute_safe",
    api: { statusUrl: "", activityUrl: "", approvalsUrl: "", validStatuses: [] },
  };
}

async function main() {
  // Register a counting test handler for the duration of the test.
  let handlerCalls = 0;
  customToolDispatch["tool.test-breach-flow"] = async () => {
    handlerCalls++;
    return { result: { ok: true } };
  };

  try {
    console.log("• Group 1 — happy path: reserve commits within cap");
    {
      resetBudgetTrackerForTests();
      handlerCalls = 0;
      const tracker = getBudgetTracker();
      tracker.openRun("breach-A", 1.0);
      const b = bundle({ capUsd: 1.0, runId: "breach-A", toolCostUsd: "0.30", toolKey: "tool.test-breach-flow" });
      await dispatchCustomTool(b, "tool.test-breach-flow", {});
      assert(handlerCalls === 1, "handler invoked");
      const snap = tracker.snapshot("breach-A");
      assert(snap?.committedTotal === 0.3, "committed = 0.3");
    }

    console.log("\n• Group 2 — cap breach: handler does NOT run, error is CapBreachError with correct fields");
    {
      resetBudgetTrackerForTests();
      handlerCalls = 0;
      const tracker = getBudgetTracker();
      tracker.openRun("breach-B", 0.5);
      const b = bundle({ capUsd: 0.5, runId: "breach-B", toolCostUsd: "0.80", toolKey: "tool.test-breach-flow" });
      let err: unknown = null;
      try { await dispatchCustomTool(b, "tool.test-breach-flow", {}); }
      catch (e) { err = e; }
      assert(err instanceof CapBreachError, "thrown error is CapBreachError");
      const ce = err as CapBreachError;
      assert(ce.toolKey === "tool.test-breach-flow", "toolKey populated");
      assert(ce.requestedUsd === 0.8, "requestedUsd = 0.8");
      assert(ce.committedUsd === 0, "committedUsd = 0 (no prior spend)");
      assert(ce.capUsd === 0.5, "capUsd = 0.5");
      assert(handlerCalls === 0, "handler did NOT run");
      const snap = tracker.snapshot("breach-B");
      assert(snap?.reservedTotal === 0, "no leaked reservation on breach");
    }

    console.log("\n• Group 3 — partial-commit-then-breach: prior commits survive, breaching call is refused");
    {
      resetBudgetTrackerForTests();
      handlerCalls = 0;
      const tracker = getBudgetTracker();
      tracker.openRun("breach-C", 1.0);
      const ok = bundle({ capUsd: 1.0, runId: "breach-C", toolCostUsd: "0.40", toolKey: "tool.test-breach-flow" });
      await dispatchCustomTool(ok, "tool.test-breach-flow", {});
      await dispatchCustomTool(ok, "tool.test-breach-flow", {});
      // 0.40 + 0.40 = 0.80 committed; next 0.40 would breach 1.0
      let err: unknown = null;
      try { await dispatchCustomTool(ok, "tool.test-breach-flow", {}); }
      catch (e) { err = e; }
      assert(err instanceof CapBreachError, "third call breaches");
      assert(handlerCalls === 2, "handler ran twice, NOT three times");
      const snap = tracker.snapshot("breach-C");
      assert(Math.abs((snap?.committedTotal ?? 0) - 0.8) < 1e-9, "prior commits preserved (0.8)");
    }

    console.log("\n• Group 4 — no tracker open (test fixture mode): handler runs, no reserve check");
    {
      resetBudgetTrackerForTests();
      handlerCalls = 0;
      const b = bundle({ capUsd: 0.1, runId: "breach-D-no-tracker", toolCostUsd: "5.00", toolKey: "tool.test-breach-flow" });
      await dispatchCustomTool(b, "tool.test-breach-flow", {});
      assert(handlerCalls === 1, "handler runs when tracker has no open run");
    }

    console.log("\n• Group 5 — zero-cost tool: skips reserve entirely (no audit emit either)");
    {
      resetBudgetTrackerForTests();
      handlerCalls = 0;
      const tracker = getBudgetTracker();
      tracker.openRun("breach-E", 1.0);
      const b = bundle({ capUsd: 1.0, runId: "breach-E", toolCostUsd: "0", toolKey: "tool.test-breach-flow" });
      await dispatchCustomTool(b, "tool.test-breach-flow", {});
      assert(handlerCalls === 1, "handler ran");
      const snap = tracker.snapshot("breach-E");
      assert(snap?.committedTotal === 0, "no commit on zero-cost tool (correctly skipped reserve path)");
    }
  } finally {
    delete customToolDispatch["tool.test-breach-flow"];
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
