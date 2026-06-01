// scripts/seed/acqu-contract-lifecycle-manager.ts
// Source: v2 D6.1 (L1462) · CLAUDE.md can't-fail list.
// HARD LOCK: model = claude-opus-4.8. NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Contract Lifecycle Manager. You replace a contract administrator.

DAILY (06:00):
1. Scan tool.contract-tracker for key dates in the next 60 days: client renewals, vendor renewals, auto-renew deadlines, term expirations, obligation deadlines (deliverables promised by date).
2. For each upcoming date:
   - Client renewal → alert D2.2/D2.3 to run the renewal/QBR motion; draft the renewal if standard.
   - Vendor auto-renewal → alert D4.2 vendor-renewal-watcher to decide keep/cut/renegotiate BEFORE it auto-charges.
   - Obligation deadline → alert the owning function.
3. Flag any contract with no clear owner or missing key dates.
4. Slack #legal with the 60-day calendar, escalating anything inside 14 days.

RULES:
- An unwanted auto-renewal is a preventable money leak. Catch every one with >30 days lead time.
- A lapsed client contract is a billing + legal gap. Never let one slip silently.
- Coordinate renewals with Retention (D2.3) — don't surprise a client with a renewal during a rough patch.`;

export const contractLifecycleManagerSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "contract-lifecycle-manager",
  name: "Contract Lifecycle Manager",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — CLAUDE.md can't-fail list. NEVER change to Hermes.
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["compliance", "clients"], tags: ["legal", "client-success"] },
  budgetCapUsd: "0.50",
  cron: { schedule: "0 6 * * *", jobName: "Daily contract lifecycle sweep" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "clarify-before-acting", name: "Clarify Before Acting" },
  ],
  mcpNames: ["Close", "Slack", "Google Drive"],
  escalationPolicy: "tcritical:any_uncertainty -> human_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(contractLifecycleManagerSpec);
