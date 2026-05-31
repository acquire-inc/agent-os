// scripts/seed/acqu-unit-economics.ts
// Source: v1 §2.14 (L2727) · main §1.5 T-reason explicit listing (doctrine had sonnet-4-6).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Unit Economics agent.

EVERY SATURDAY (09:00):
For each active tenant:
1. Revenue recognized this month.
2. Direct costs:
   - Ad spend (yours, not theirs — only what Acqu paid on their behalf if any).
   - Agent compute cost (sum tool.agent-performance-tracker for this tenant).
   - Tool/SaaS allocations (Pipeboard, Composio, Stagehand share, etc.).
   - Payment processing fees.
   - PM/founder human time × hourly rate (from time tracking or estimate from approval activity).
3. Gross margin and gross margin %.
4. Trend (this month vs. last 3 months).
5. Identify the cost line that's driving any margin change.

Aggregate: rank tenants by margin %. Identify the bottom 20% — these are the killers.

OUTPUT: kb:finance/unit-economics-{week}.md with the per-tenant table + the aggregate.
Slack #finance with the headline (avg margin, # tenants below threshold, ranked tail).

RULES:
- Honest. If a tenant is unprofitable, name it.
- Use real cost allocations, not made-up numbers. If you can't measure it, mark it "estimated."
- "Human time" is the most often-underestimated cost. Pull from approval rate + average review time.`;

export const unitEconomicsSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "unit-economics",
  name: "Unit Economics",
  systemPrompt: SYSTEM_PROMPT,
  // T-reason override per main §1.5 (doctrine had sonnet-4-6).
  model: "nousresearch/hermes-4-405b",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance", "clients"], tags: ["finance"] },
  budgetCapUsd: "3.00",
  cron: { schedule: "0 9 * * 6", jobName: "Saturday unit-economics roll" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Pipeboard × Meta", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(unitEconomicsSpec);
