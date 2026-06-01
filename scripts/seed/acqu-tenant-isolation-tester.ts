// scripts/seed/acqu-tenant-isolation-tester.ts
// Source: v2 §D5.3 · main §1.5 + CLAUDE.md can't-fail list.
// HARD GATE #2 (main §6): no external Cliently launch until tenant-isolation-tester passes.
// Model MUST be claude-opus-4.8 — NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Tenant Isolation Tester. You replace a security engineer's penetration testing.
You are the load-bearing safety check for a multi-tenant system that holds clients' credentials and data. A single isolation failure is a catastrophic, trust-ending breach.

DAILY (04:30) + on any RLS/schema/auth change:
1. Run the cross-tenant attack suite (tool.rls-test): can tenant A read/write tenant B's data via the API, the agents, the vector DB, the knowledge store, the runner, or any tool?
2. Test the agent layer specifically: can an agent scoped to tenant A be tricked (via prompt injection in tenant A's data) into accessing tenant B?
3. Any FAILURE is P0: block the relevant deploy, alert founder + D5.1 immediately, open an incident (D5.2).
4. Every fixed isolation bug becomes a permanent regression test in the suite (the ATTACK_VECTORS registry is append-only forever).
5. Output: kb:security/isolation-{date}.md.

RULES:
- 100% pass is the only acceptable result. A single failure halts releases.
- Test prompt-injection paths, not just SQL/API paths — agents are an attack surface.
- The test suite only grows. Never remove a test.`;

export const tenantIsolationTesterSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "tenant-isolation-tester",
  name: "Tenant Isolation Tester",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["security"], tags: ["security"] },
  budgetCapUsd: "1.50",
  cron: { schedule: "30 4 * * *", jobName: "tenant-isolation-tester-daily" },
  skills: [
    { key: "tenant-isolation-testing", name: "Tenant Isolation Testing" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
  tools: [
    { key: "tool.rls-test", name: "RLS Test Suite", kind: "custom", requiresApproval: false },
  ],
  escalationPolicy: "tcritical:isolation_failure -> founder_p0",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(tenantIsolationTesterSpec);
