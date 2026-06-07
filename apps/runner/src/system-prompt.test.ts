// Phase 59: system-prompt delegation primer test.
// Run: pnpm --filter @agent-os/runner test:system-prompt

import { buildSystemPrompt } from "./execute.js";
import type { Bundle } from "./api-client.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function bundle(opts: { skills?: Bundle["skills"]; autonomy?: string }): Bundle {
  return {
    run: { id: "r-1", status: "running", triggerSource: "test", scheduledFor: null, sdkSessionId: null },
    job: null,
    agent: {
      id: "agent-1", tenantId: "tenant-1", key: "test-agent", name: "Test Agent",
      persona: null, backend: "claude-agent-sdk", model: "m",
      thinkingLevel: "low", autonomy: opts.autonomy ?? "execute_safe",
      escalationPolicy: null, budgetCapUsd: 1, runnerKind: "local",
    },
    skills: opts.skills ?? [],
    mcpServers: [],
    tools: [],
    knowledge: [],
    envVars: {},
    autonomy: opts.autonomy ?? "execute_safe",
    api: { statusUrl: "", activityUrl: "", approvalsUrl: "", validStatuses: [] },
  };
}

async function main() {
  console.log("• Group 1 — no delegatable skills: prompt has no delegation section");
  {
    const prompt = buildSystemPrompt(bundle({ skills: [
      { key: "v", name: "Verify", description: "verify outputs", preferredModelTier: null, taskProfile: {}, costEstimateUsd: "0" },
    ] }));
    assert(!prompt.includes("Skill delegation"), "no 'Skill delegation' section");
    assert(!prompt.includes("tool.delegate"), "no tool.delegate reference");
  }

  console.log("\n• Group 2 — skill with task_profile triggers delegation primer");
  {
    const prompt = buildSystemPrompt(bundle({ skills: [
      { key: "briefing-synthesis", name: "Briefing Synthesis", description: "Compose briefings",
        preferredModelTier: null,
        taskProfile: { capabilities: { reasoning: 1, summarization: 1 } },
        costEstimateUsd: "0.05" },
    ] }));
    assert(prompt.includes("## Skill delegation"), "delegation section present");
    assert(prompt.includes("tool.delegate"), "tool.delegate referenced");
    assert(prompt.includes("briefing-synthesis"), "skill_key listed");
    assert(prompt.includes("Briefing Synthesis"), "skill name in primer");
  }

  console.log("\n• Group 3 — skill with preferred_model_tier (but empty profile) also triggers primer");
  {
    const prompt = buildSystemPrompt(bundle({ skills: [
      { key: "decisive-analysis", name: "Decisive Analysis", description: "",
        preferredModelTier: "T-reason", taskProfile: {}, costEstimateUsd: "0" },
    ] }));
    assert(prompt.includes("## Skill delegation"), "primer present");
    assert(prompt.includes("decisive-analysis"), "skill_key listed");
  }

  console.log("\n• Group 4 — mixed skills: only delegatable ones appear in primer");
  {
    const prompt = buildSystemPrompt(bundle({ skills: [
      { key: "v", name: "Verify", description: "", preferredModelTier: null, taskProfile: {}, costEstimateUsd: "0" },
      { key: "briefing-synthesis", name: "Briefing", description: "",
        preferredModelTier: null,
        taskProfile: { capabilities: { reasoning: 1 } },
        costEstimateUsd: "0.05" },
    ] }));
    assert(prompt.includes("briefing-synthesis"), "delegatable skill listed");
    // Both skills should appear in the 'Skills available' section.
    assert(prompt.match(/Skills available/), "Skills available section present");
    // Verify shouldn't show up in the delegation primer as a tool.delegate target.
    const delegateSection = prompt.split("## Skill delegation")[1] ?? "";
    assert(!delegateSection.includes("skill_key: \"v\""), "non-delegatable skill omitted from primer");
  }

  console.log("\n• Group 5 — proper autonomy line preserved");
  {
    const prompt = buildSystemPrompt(bundle({ autonomy: "propose" }));
    assert(prompt.includes("## Autonomy: propose"), "autonomy line present");
    assert(prompt.includes("DO NOT take irreversible actions"), "propose guidance present");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
