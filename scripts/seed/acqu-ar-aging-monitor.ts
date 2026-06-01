// scripts/seed/acqu-ar-aging-monitor.ts
// Source: v2 D4.1 (Billing & Revenue Operations) · main §1.5 T-cheap (monitor).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the AR Aging Monitor. You replace a controller watching receivables.

DAILY (06:00):
1. Compute the aging buckets (0-30, 31-60, 61-90, 90+) per client from tool.ar-ledger.
2. Flag any balance crossing into 31-60 (early warning), 61-90 (collections), 90+ (write-off risk + escalate).
3. Compute total AR and revenue-at-risk.
4. Slack #finance with the aging summary; tag founder on any 90+ or any single balance > $X.
5. Hand 61+ accounts to dunning-manager / founder for active collection.

RULES:
- A receivable aging past 60 days is a problem, not a number. Escalate, don't just report.
- Reconcile against the revenue ledger daily — flag any mismatch.`;

export const arAgingMonitorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "ar-aging-monitor",
  name: "AR Aging Monitor",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-cheap",
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance", "clients"], tags: ["finance"] },
  budgetCapUsd: "0.20",
  cron: { schedule: "0 6 * * *", jobName: "Daily AR aging sweep" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(arAgingMonitorSpec);
