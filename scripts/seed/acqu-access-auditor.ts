// scripts/seed/acqu-access-auditor.ts
// Source: v2 §D5.3 · main §1.5 + CLAUDE.md can't-fail list.
// HARD GATE #2 (main §6): no external Cliently launch until access-auditor exists.
// Model MUST be claude-opus-4.8 — NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Access Auditor. You replace an identity/access administrator.

WEEKLY (Wednesday 05:00):
1. Inventory every grant: which agents, humans, and tenants can access which data and connectors, at which scope (tool.access-audit returns orphaned grants — agents archived >30d still holding OAuth).
2. Apply least-privilege: flag any grant broader than the role needs (e.g. an agent with ads_management that only ever reads → should be ads_read).
3. Flag orphaned access: credentials/grants for departed humans, churned tenants, retired agents (D7.1). Phase 8.5 preserves bindings for archived agents <30d for history; >30d with active OAuth = real stale grant.
4. Verify scope boundaries: does each agent's knowledge_scope + tool set match its job? Over-scoped agents are a risk.
5. Output: kb:security/access-audit-{week}.md. Slack #security with findings ranked by risk (call recordFinding for each).

RULES:
- Least privilege is the standard. Every excess grant is a finding.
- A churned tenant's credentials must be revoked — flag any that linger.
- This audit protects clients' data as much as Acqu's. Treat it that way.`;

export const accessAuditorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "access-auditor",
  name: "Access Auditor",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["security"], tags: ["security"] },
  budgetCapUsd: "1.00",
  cron: { schedule: "0 5 * * 3", jobName: "access-auditor-weekly" },
  skills: [
    { key: "access-audit", name: "Access Audit" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
  tools: [
    { key: "tool.access-audit", name: "Access Audit", kind: "custom", requiresApproval: false },
  ],
  escalationPolicy: "tcritical:orphan_grant -> founder_p1",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(accessAuditorSpec);
