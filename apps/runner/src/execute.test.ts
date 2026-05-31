// Runner execution test (no DB, no network, no Anthropic key).
// Proves a vitals-shaped agent runs end-to-end through executeRun's dry-run path:
//  - bound catalog tools surface in the system prompt (Phase 6/7 integration)
//  - the full loop records activity and reaches a terminal/awaiting state
//  - under execute_safe the PreToolUse gate fires (proposes the mutation → waiting)
// Run: pnpm --filter @agent-os/runner test
import type { ApiClient, Bundle } from "./api-client.js";
import { buildSystemPrompt, executeRun } from "./execute.js";
import type { RunnerConfig } from "./config.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) (passed++, console.log(`  ✓ ${msg}`));
  else (failed++, console.error(`  ✗ ${msg}`));
}

/** Records every API call the runner makes, so we can assert the trail without a server. */
function stubApi() {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve();
  };
  const api = {
    postActivity: rec("postActivity"),
    postAudit: rec("postAudit"),
    postAutonomyEvent: rec("postAutonomyEvent"),
    postApproval: rec("postApproval"),
    putStatus: rec("putStatus"),
    next: rec("next"),
  } as unknown as ApiClient;
  return { api, calls };
}

function vitalsBundle(autonomy: string, sdkSessionId: string | null = null): Bundle {
  return {
    run: { id: "00000000-0000-0000-0000-0000000000aa", status: "running", triggerSource: "schedule", scheduledFor: null, sdkSessionId },
    job: { name: "morning-vitals", instructions: "Post the daily metrics snapshot to Slack.", scheduleCron: "30 6 * * *" },
    agent: {
      key: "vitals", name: "Vitals", persona: "You are Vitals.", backend: "claude-agent-sdk", model: "nousresearch/hermes-4-405b",
      thinkingLevel: "low", autonomy, escalationPolicy: null, budgetCapUsd: 0.4, runnerKind: "pull",
    },
    skills: [{ key: "morning-vitals", name: "morning-vitals", description: "Fetch metrics snapshot" }],
    tools: [
      { key: "tool.22", name: "Run-Summary Writer", description: "writes run summaries", kind: "custom", requiresApproval: false, reversible: true },
      { key: "tool.2", name: "Ad Launcher", description: "launches ads", kind: "custom", requiresApproval: true, reversible: false },
    ],
    mcpServers: [{ name: "Slack", transport: "http", endpoint: null, authType: "none", credentials: null }],
    knowledge: [],
    envVars: {},
    autonomy,
    api: { statusUrl: "x", activityUrl: "x", approvalsUrl: "x", validStatuses: ["waiting", "done"] },
  };
}

const dryCfg = { dryRun: true } as unknown as RunnerConfig;

async function main() {
  console.log("\n[system prompt — tools surface]");
  const prompt = buildSystemPrompt(vitalsBundle("execute_safe"));
  assert(prompt.includes("Deterministic tools"), "prompt has a tools section");
  assert(prompt.includes("tool.22") && prompt.includes("tool.2"), "prompt lists the agent's bound tool keys");
  assert(/tool\.2 .*requires approval/.test(prompt), "approval-gated tool flagged in the prompt");

  console.log("\n[executeRun dry-run — execute_safe proposes the mutation]");
  const safe = stubApi();
  const r1 = await executeRun(safe.api, vitalsBundle("execute_safe"), dryCfg);
  assert(r1.status === "waiting", "execute_safe run suspends awaiting approval");
  assert(safe.calls.some((c) => c.method === "postActivity"), "activity is recorded");
  assert(safe.calls.some((c) => c.method === "postApproval"), "an approval is raised at the gate");
  assert(safe.calls.some((c) => c.method === "postAutonomyEvent"), "an autonomy event is recorded");

  console.log("\n[executeRun dry-run — resume past the gate completes]");
  const resume = stubApi();
  const r2 = await executeRun(resume.api, vitalsBundle("execute_safe", "dry_resume"), dryCfg);
  assert(r2.status === "done", "resumed run (sdkSessionId set) completes");
  assert(resume.calls.some((c) => c.method === "postActivity" && String(c.args[1]) === "summary"), "a summary activity is posted");

  console.log("\n[executeRun dry-run — execute_full auto-allows]");
  const full = stubApi();
  const r3 = await executeRun(full.api, vitalsBundle("execute_full"), dryCfg);
  assert(r3.status === "done", "execute_full run completes without proposing");
  assert(!full.calls.some((c) => c.method === "postApproval"), "no approval raised under execute_full");

  console.log("\n[backend switch — managed-agents routes to its backend (v3 F)]");
  const mb = vitalsBundle("execute_safe");
  mb.agent.backend = "managed-agents";
  const managed = stubApi();
  // Non-dry: routes to managedAgentsRun. With no Anthropic runtime/network it fails soft
  // (status failed) but must post the Managed Agents start activity, proving the switch.
  const rm = await executeRun(managed.api, mb, { dryRun: false, apiKey: "x", apiUrl: "x", runnerId: "t" } as unknown as RunnerConfig);
  assert(
    managed.calls.some((c) => c.method === "postActivity" && /Managed Agents backend/.test(String(c.args[2]))),
    "managed-agents backend posts its start activity (routed, not SDK path)",
  );
  assert(rm.status === "done" || rm.status === "failed", "managed-agents run resolves (soft-fails without runtime)");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
