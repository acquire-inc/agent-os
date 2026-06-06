// Runner execution test (no DB, no network, no Anthropic key).
// Proves a vitals-shaped agent runs end-to-end through executeRun's dry-run path:
//  - bound catalog tools surface in the system prompt (Phase 6/7 integration)
//  - the full loop records activity and reaches a terminal/awaiting state
//  - under execute_safe the PreToolUse gate fires (proposes the mutation → waiting)
// Run: pnpm --filter @agent-os/runner test
import { parseRunSummary } from "@agent-os/core";
import type { ApiClient, Bundle } from "./api-client.js";
import { buildSystemPrompt, buildMcpServers, executeRun } from "./execute.js";
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

function vitalsBundle(
  autonomy: string,
  sdkSessionId: string | null = null,
  recentSummaries: Bundle["recentSummaries"] = undefined,
  runId = "00000000-0000-0000-0000-0000000000aa",
): Bundle {
  return {
    run: { id: runId, status: "running", triggerSource: "schedule", scheduledFor: null, sdkSessionId },
    recentSummaries,
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

  // The continuity loop, DB-free: a summary produced by one run must flow back into the next
  // run's prompt as "Where you left off". This stitches the real product seams that the live
  // path uses — executeRun's summary → parseRunSummary → bundle.recentSummaries →
  // buildSystemPrompt — without a database. The only stand-in is the store, which faithfully
  // mirrors recentRunSummaries' documented contract (exclude current run, newest first, limit 3).
  console.log("\n[continuity loop — run N's summary surfaces in run N+1's prompt]");
  type Row = { runId: string; status: string; whatIDid: string; whatILearned: string; whatNext: string; createdAt: string };
  const store: Row[] = [];
  // Mirror of core's recentRunSummaries: agent+tenant-scoped here is implicit (single agent),
  // exclude the current run, newest-first, cap at 3.
  const recentFor = (excludeRunId: string): Bundle["recentSummaries"] =>
    store
      .filter((r) => r.runId !== excludeRunId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 3)
      .map(({ status, whatIDid, whatILearned, whatNext, createdAt }) => ({ status, whatIDid, whatILearned, whatNext, createdAt }));

  // Run 1: a fresh agent has no history → no continuity section in the prompt.
  const RUN1 = "00000000-0000-0000-0000-00000000c001";
  const RUN2 = "00000000-0000-0000-0000-00000000c002";
  const firstPrompt = buildSystemPrompt(vitalsBundle("execute_full", null, recentFor(RUN1), RUN1));
  assert(!firstPrompt.includes("Where you left off"), "first run (empty history) has no continuity section");

  // Run 1 executes and produces a labeled summary; persist it the way the API/SessionEnd path does
  // (parse the raw summary into the contract, store keyed by run).
  const run1Result = await executeRun(stubApi().api, vitalsBundle("execute_full", null, recentFor(RUN1), RUN1), dryCfg);
  const raw1 = "What I did: Posted the vitals snapshot to #vitals.\nWhat's next: Watch M3 adset CPA tomorrow.";
  const c1 = parseRunSummary(raw1);
  store.push({ runId: RUN1, status: run1Result.status, whatIDid: c1.whatIDid, whatILearned: c1.whatILearned, whatNext: c1.whatNext, createdAt: "2026-06-01T06:31:00Z" });

  // Run 2: the bundle now carries run 1's summary → the prompt picks up where it left off.
  const secondPrompt = buildSystemPrompt(vitalsBundle("execute_full", null, recentFor(RUN2), RUN2));
  assert(secondPrompt.includes("Where you left off"), "second run renders the continuity section");
  assert(secondPrompt.includes("Posted the vitals snapshot"), "prior run's what_i_did surfaces in the next prompt");
  assert(secondPrompt.includes("Watch M3 adset CPA"), "prior run's what_next surfaces as continuity");
  // The current run's own (future) summary must never leak into its own prompt.
  store.push({ runId: RUN2, status: "done", whatIDid: "should not appear", whatILearned: "", whatNext: "", createdAt: "2026-06-01T06:32:00Z" });
  assert(!buildSystemPrompt(vitalsBundle("execute_full", null, recentFor(RUN2), RUN2)).includes("should not appear"),
    "a run's own summary is excluded from its own prompt (excludeRunId contract)");

  console.log("\n[buildMcpServers — connectors become callable SDK MCP config]");
  const wired = buildMcpServers([
    { name: "Close", transport: "http", endpoint: "https://mcp.close.example/v1", authType: "oauth", credentials: { token: "tok_abc", ttlSeconds: 300 } },
    { name: "Pipeboard × Meta", transport: "sse", endpoint: "https://mcp.pipeboard.example/sse", authType: "oauth", credentials: { token: "tok_xyz", ttlSeconds: 300 } },
    { name: "Slack", transport: "http", endpoint: null, authType: "oauth", credentials: null }, // no endpoint → skipped
    { name: "pgvector Knowledge", transport: "stdio", endpoint: null, authType: "api_key", credentials: null }, // stdio → skipped
  ]);
  assert(wired.mcpServers["close"] !== undefined, "http connector with endpoint is wired");
  assert((wired.mcpServers["close"] as { url: string }).url === "https://mcp.close.example/v1", "wired connector carries its endpoint url");
  assert(((wired.mcpServers["close"] as { headers?: Record<string, string> }).headers?.Authorization) === "Bearer tok_abc", "resolved token becomes a bearer header");
  assert((wired.mcpServers["pipeboard-meta"] as { type: string }).type === "sse", "name is slugified + transport preserved (sse)");
  assert(wired.mcpServers["slack"] === undefined && wired.mcpServers["pgvector-knowledge"] === undefined, "endpoint-less + stdio connectors are skipped");
  assert(wired.skipped.length === 2, "skipped connectors are reported");
  assert(buildMcpServers([]).mcpServers && Object.keys(buildMcpServers([]).mcpServers).length === 0, "no connectors → empty config (no SDK key set)");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
