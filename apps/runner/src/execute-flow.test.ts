// Phase 34 integration test: full executeRun lifecycle.
//
// Asserts the multi-phase contract across cantfail / CRA gates,
// BudgetTracker open/synthesize/close, autonomy ratchet, and run-state
// cleanup. Uses dryRun for the actual model call (no live SDK).
//
// Run: pnpm --filter @agent-os/runner test:execute-flow

import { executeRun } from "./execute.js";
import { getBudgetTracker, resetBudgetTrackerForTests } from "./budget.js";
import {
  effectiveAutonomy,
  getAutonomyOverride,
  ratchetAutonomy,
  resetAllRunStateForTests,
} from "./run-state.js";
import type { ApiClient, Bundle } from "./api-client.js";
import type { RunnerConfig } from "./config.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function makeApi() {
  const activities: { kind: string; message: string }[] = [];
  return {
    api: {
      postActivity: async (_runId: string, kind: string, message: string) => {
        activities.push({ kind, message });
      },
      next: async () => ({ hasWork: false }),
      putStatus: async () => undefined,
      postApproval: async () => undefined,
    } as unknown as ApiClient,
    activities,
  };
}

function bundle(opts: {
  agentKey: string;
  model: string;
  capUsd?: number;
  runId?: string;
  persona?: string | null;
  autonomy?: string;
}): Bundle {
  return {
    run: {
      id: opts.runId ?? "flow-run-1",
      status: "running",
      triggerSource: "test",
      scheduledFor: null,
      sdkSessionId: null,
    },
    job: null,
    agent: {
      id: "agent-1",
      tenantId: "tenant-1",
      key: opts.agentKey,
      name: "Test Agent",
      persona: opts.persona ?? null,
      backend: "claude-agent-sdk",
      model: opts.model,
      thinkingLevel: "low",
      autonomy: opts.autonomy ?? "execute_safe",
      escalationPolicy: null,
      budgetCapUsd: opts.capUsd ?? 2.0,
      runnerKind: "local",
    },
    skills: [],
    mcpServers: [],
    tools: [],
    knowledge: [],
    envVars: {},
    autonomy: opts.autonomy ?? "execute_safe",
    api: { statusUrl: "", activityUrl: "", approvalsUrl: "", validStatuses: [] },
  };
}

const dryCfg: RunnerConfig = {
  apiKey: "test",
  apiUrl: "http://localhost:8787",
  runnerId: "test-runner",
  agentIds: [],
  pollIntervalMs: 1000,
  once: true,
  anthropicKey: undefined,
  dryRun: true,
};

async function main() {
  console.log("• Group 1 — happy path: dryRun lifecycle with full cleanup");
  {
    resetBudgetTrackerForTests();
    resetAllRunStateForTests();
    const { api } = makeApi();
    const tracker = getBudgetTracker();
    const b = bundle({ agentKey: "vitals", model: "nousresearch/hermes-4-70b", runId: "flow-A" });
    const result = await executeRun(api, b, dryCfg);
    assert(result.status === "done", `dryRun completes (got ${result.status})`);
    assert(result.costUsd > 0, "dryRun reports costUsd");
    assert(!tracker.hasRun("flow-A"), "tracker closed after dispatch");
    assert(getAutonomyOverride("flow-A") === null, "run-state cleared after dispatch");
  }

  console.log("\n• Group 2 — cantfail violation: BudgetTracker still closes (CR-08 guard)");
  {
    resetBudgetTrackerForTests();
    resetAllRunStateForTests();
    const { api } = makeApi();
    const tracker = getBudgetTracker();
    const b = bundle({
      agentKey: "tenant-isolation-tester",
      model: "nousresearch/hermes-4-405b", // T-critical on Hermes -> cantfail
      runId: "flow-B",
    });
    const result = await executeRun(api, b, dryCfg);
    assert(result.status === "failed", "T-critical on Hermes -> failed");
    assert(
      result.summary.includes("cantfail.model_violation"),
      "summary names cantfail.model_violation",
    );
    assert(result.costUsd === 0, "no cost on cantfail");
    assert(!tracker.hasRun("flow-B"), "tracker closed even on cantfail (CR-08)");
  }

  console.log("\n• Group 3 — CRA violation: BudgetTracker still closes");
  {
    resetBudgetTrackerForTests();
    resetAllRunStateForTests();
    const { api } = makeApi();
    const tracker = getBudgetTracker();
    const b = bundle({
      agentKey: "loan-screener",
      model: "nousresearch/hermes-4-70b",
      runId: "flow-C",
      persona: "Decide credit eligibility for each applicant based on the bureau report.",
    });
    const result = await executeRun(api, b, dryCfg);
    assert(result.status === "failed", "CRA-touching persona -> failed");
    assert(result.summary.includes("cra_violation"), "summary names cra_violation");
    assert(!tracker.hasRun("flow-C"), "tracker closed even on CRA violation");
  }

  console.log("\n• Group 4 — autonomy ratchet survives executeRun and clears at end");
  {
    resetBudgetTrackerForTests();
    resetAllRunStateForTests();
    const { api } = makeApi();
    // Pre-ratchet the run before executeRun fires (simulates a previous
    // tool.browser invocation in the same run that detected an injection).
    ratchetAutonomy("flow-D", "propose", "test pre-ratchet");
    assert(effectiveAutonomy("flow-D", "execute_safe") === "propose", "pre-ratchet active");

    const b = bundle({ agentKey: "vitals", model: "nousresearch/hermes-4-70b", runId: "flow-D" });
    const result = await executeRun(api, b, dryCfg);
    assert(result.status === "done", "dispatch completes");
    // After executeRun, clearRunState should have wiped the ratchet.
    assert(getAutonomyOverride("flow-D") === null, "ratchet cleared by clearRunState");
  }

  console.log("\n• Group 5 — cap=0 path still closes the tracker (WR-11)");
  {
    resetBudgetTrackerForTests();
    resetAllRunStateForTests();
    const { api } = makeApi();
    const tracker = getBudgetTracker();
    const b = bundle({
      agentKey: "vitals",
      model: "nousresearch/hermes-4-70b",
      capUsd: 0,
      runId: "flow-E",
    });
    const result = await executeRun(api, b, dryCfg);
    assert(result.status === "done", "cap=0 still dispatches");
    assert(!tracker.hasRun("flow-E"), "tracker closed even with cap=0");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
