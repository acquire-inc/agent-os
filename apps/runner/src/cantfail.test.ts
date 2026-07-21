// Unit test for the SessionStart cantfail.model_violation runtime assertion.
// Per AGENT-OS-PLAN.md Open Q #1 (RESOLVED) — belt-and-suspenders for the
// seedAgent exemption: even if a T-critical agent's row is somehow on a
// non-Opus model at runtime, the runner fails the run closed BEFORE model
// dispatch.
//
// Run: pnpm --filter @agent-os/runner test:cantfail
//
// No live model, no live DB. The test asserts behavior at the executeRun
// entry: a T-critical agent with model='nousresearch/hermes-4-405b' returns
// { status: 'failed', summary: starts-with 'cantfail.model_violation' }.

import { executeRun } from "./execute.js";
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
  const api = {
    postActivity: async (_runId: string, kind: string, message: string) => {
      activities.push({ kind, message });
    },
    // Methods we don't exercise — present so the type matches.
    next: async () => ({ hasWork: false }),
    putStatus: async () => undefined,
    postApproval: async () => undefined,
  } as unknown as ApiClient;
  return { api, activities };
}

function bundle(opts: { agentKey: string; model: string }): Bundle {
  return {
    run: { id: "run-1", status: "running", triggerSource: "test", scheduledFor: null, sdkSessionId: null },
    job: null,
    agent: {
      id: "agent-1",
      tenantId: "tenant-1",
      key: opts.agentKey,
      name: "Test",
      persona: null,
      backend: "claude-agent-sdk",
      model: opts.model,
      thinkingLevel: "high",
      autonomy: "execute_safe",
      escalationPolicy: null,
      budgetCapUsd: null,
      runnerKind: "local",
    },
    skills: [],
    mcpServers: [],
    tools: [],
    knowledge: [],
    envVars: {},
    autonomy: "execute_safe",
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
  authMode: "dry-run" as const,
  dryRun: true,
};

async function main() {
  console.log("• T-critical agent on Hermes → fail closed, no dispatch");
  // tenant-isolation-tester is on the CANT_FAIL_KEYS set in
  // packages/core/src/architect/hydrate.ts. With model=hermes-4-405b
  // the SessionStart assertion must short-circuit BEFORE dryRun executes.
  const { api: apiA, activities: actA } = makeApi();
  const resultA = await executeRun(
    apiA,
    bundle({ agentKey: "tenant-isolation-tester", model: "nousresearch/hermes-4-405b" }),
    dryCfg,
  );
  assert(resultA.status === "failed", "result.status === 'failed'");
  assert(
    typeof resultA.summary === "string" && resultA.summary.startsWith("cantfail.model_violation"),
    `summary starts with cantfail.model_violation (got: ${resultA.summary})`,
  );
  assert(resultA.tokensIn === 0 && resultA.tokensOut === 0, "no tokens consumed (no dispatch)");
  assert(resultA.costUsd === 0, "no cost incurred (no dispatch)");
  assert(
    actA.some(
      (a) => a.kind === "error" && a.message.includes("cantfail.model_violation"),
    ),
    "ApiClient.postActivity called with error including cantfail.model_violation",
  );

  console.log("• T-critical agent on Opus → assertion passes, dispatch proceeds (dry-run)");
  const { api: apiB } = makeApi();
  const resultB = await executeRun(
    apiB,
    bundle({ agentKey: "tenant-isolation-tester", model: "anthropic/claude-opus-4.8" }),
    dryCfg,
  );
  assert(resultB.status === "done", `T-critical on Opus completes dry-run (got status=${resultB.status})`);

  console.log("• Non-T-critical agent on Hermes → assertion does not fire");
  // 'vitals' is NOT on the can't-fail list; Hermes is the correct tier for it.
  const { api: apiC } = makeApi();
  const resultC = await executeRun(
    apiC,
    bundle({ agentKey: "vitals", model: "nousresearch/hermes-4-70b" }),
    dryCfg,
  );
  assert(resultC.status === "done", `non-T-critical on Hermes completes dry-run (got status=${resultC.status})`);

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
