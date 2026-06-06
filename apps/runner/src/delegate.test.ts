// Phase 58: tool.delegate auto-routing test.
//
// Verifies the built-in tool.delegate handler in dispatchCustomTool:
//   - Looks up the named skill from bundle.skills
//   - Routes via dispatchSubAgent on the picked model
//   - Persists a structured artifact file with the sub-agent result
//
// Run: pnpm --filter @agent-os/runner test:delegate

import { dispatchCustomTool, deriveAllowedTools } from "./custom-tools.js";
import { customToolDispatch } from "./custom-tools.js";
import { getBudgetTracker, resetBudgetTrackerForTests } from "./budget.js";
import type { Bundle } from "./api-client.js";
import { readFile } from "node:fs/promises";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function bundle(opts: {
  runId: string;
  skills?: Bundle["skills"];
}): Bundle {
  return {
    run: { id: opts.runId, status: "running", triggerSource: "test", scheduledFor: null, sdkSessionId: null },
    job: null,
    agent: {
      id: "agent-1", tenantId: "tenant-1", key: "delegating-agent", name: "Delegator",
      persona: null, backend: "claude-agent-sdk", model: "nousresearch/hermes-4-70b",
      thinkingLevel: "low", autonomy: "execute_safe",
      escalationPolicy: null, budgetCapUsd: 5.0, runnerKind: "local",
    },
    skills: opts.skills ?? [],
    mcpServers: [],
    tools: [],
    knowledge: [],
    envVars: {},
    autonomy: "execute_safe",
    api: { statusUrl: "", activityUrl: "", approvalsUrl: "", validStatuses: [] },
  };
}

async function main() {
  // Stub the SDK by injecting a sub-agent module replacement.
  // Easier: register a fake @anthropic-ai/claude-agent-sdk stub via the
  // module loader. We instead leverage the sub-agent's sdkOverride path
  // by short-circuiting at the catalog / picker layer.

  console.log("• Group 1 — deriveAllowedTools includes tool.delegate when skills bound");
  {
    const b = bundle({ runId: "delegate-A", skills: [
      { key: "briefing-synthesis", name: "Briefing Synthesis", description: "",
        preferredModelTier: "T-reason", taskProfile: { capabilities: { reasoning: 1, summarization: 1 } }, costEstimateUsd: "0.05" },
    ] });
    const allowed = deriveAllowedTools(b);
    assert(allowed.includes("tool.delegate"), "delegate enabled when skills bound");
  }

  console.log("\n• Group 2 — deriveAllowedTools omits tool.delegate when no skills bound");
  {
    const b = bundle({ runId: "delegate-B", skills: [] });
    const allowed = deriveAllowedTools(b);
    assert(!allowed.includes("tool.delegate"), "delegate not enabled without skills");
  }

  console.log("\n• Group 3 — tool.delegate refuses when skill_key missing");
  {
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("delegate-C", 5.0);
    const b = bundle({ runId: "delegate-C", skills: [
      { key: "briefing-synthesis", name: "Briefing", description: "",
        preferredModelTier: null, taskProfile: {}, costEstimateUsd: "0" },
    ] });
    let err: unknown = null;
    try { await dispatchCustomTool(b, "tool.delegate", {}); } catch (e) { err = e; }
    assert((err as Error)?.message?.includes("skill_key"), `error names missing field (got: ${(err as Error)?.message})`);
  }

  console.log("\n• Group 4 — tool.delegate refuses unknown skill");
  {
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("delegate-D", 5.0);
    const b = bundle({ runId: "delegate-D", skills: [
      { key: "briefing-synthesis", name: "Briefing", description: "",
        preferredModelTier: null, taskProfile: {}, costEstimateUsd: "0" },
    ] });
    let err: unknown = null;
    try { await dispatchCustomTool(b, "tool.delegate", { skill_key: "not-bound", prompt: "x" }); }
    catch (e) { err = e; }
    assert((err as Error)?.message?.includes("not bound"), `error names not-bound skill (got: ${(err as Error)?.message})`);
  }

  console.log("\n• Group 5 — tool.delegate writes a structured artifact (smoke path)");
  {
    // This path will fail to import the live SDK in the sandbox, so the
    // sub-agent will return ok=false with an SDK-import-failed error.
    // We verify the artifact file is still written with the failure detail —
    // that's the contract: delegate ALWAYS writes a result file.
    resetBudgetTrackerForTests();
    const tracker = getBudgetTracker();
    tracker.openRun("delegate-E", 5.0);
    const b = bundle({ runId: "delegate-E", skills: [
      { key: "briefing-synthesis", name: "Briefing", description: "",
        preferredModelTier: "T-reason", taskProfile: { capabilities: { reasoning: 1 } }, costEstimateUsd: "0" },
    ] });
    const out = await dispatchCustomTool(b, "tool.delegate", {
      skill_key: "briefing-synthesis",
      prompt: "Summarize the Q3 report.",
    });
    assert(out.toolKey === "tool.delegate", "toolKey echoed");
    assert(out.resultPath.includes("delegate-briefing-synthesis-result.json"), `resultPath names skill (got ${out.resultPath})`);
    const contents = JSON.parse(await readFile(out.resultPath, "utf8"));
    assert(contents.delegated_to_skill === "briefing-synthesis", "artifact names skill");
    assert(typeof contents.ok === "boolean", "ok field present");
    assert(typeof contents.model_ran === "string", "model_ran present");
    assert("result" in contents, "result field present");
    assert("pick_rationale" in contents && "pick_source" in contents, "pick rationale + source surfaced");
  }

  // Cleanup any test handlers registered during the run.
  for (const key of Object.keys(customToolDispatch)) {
    if (key.startsWith("tool.test-")) delete customToolDispatch[key];
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
