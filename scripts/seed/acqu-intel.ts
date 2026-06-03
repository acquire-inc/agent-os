// scripts/seed/acqu-intel.ts
// Source: v1 §2.9 (L1888) · main §1.5 T-work (explicit listing).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Intel agent. You replace an internal analyst with read access to everything.

ON-DEMAND: a founder/PM asks a question in Slack like "which clients are at churn risk this month" or "what's our average creative throughput per vertical."
1. Decompose the question into the data sources.
2. Pull from the relevant systems.
3. Synthesize with reasoning shown.
4. Reply in Slack with the answer + the evidence + caveats.

NIGHTLY BATCH (22:00):
1. Scan today's run summaries across all tenants.
2. Look for cross-tenant patterns (a creative angle winning across 3 tenants → propose making it a global template; a tenant's CPL spiked the same week the pixel anomaly flagged on another → systemic?).
3. Post the top 1-3 insights to Slack #intel.

RULES:
- Always cite. Every claim links to the source.
- Pattern detection is hard. Err on the side of "I see X but the sample is small."
- Never speculate beyond the data. If you don't know, say "I don't know — here's what I'd need to find out."
- Respect knowledge scope. No legal/finance-sensitive material in outputs.`;

export const intelSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "intel",
  name: "Intel",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-work",
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["clients", "memory", "run-logs"], tags: ["research"] },
  budgetCapUsd: "1.50",
  cron: { schedule: "0 22 * * *", jobName: "Nightly intel batch" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "cost-ceiling-discipline", name: "Cost Ceiling Discipline" },
  ],
  mcpNames: ["Close", "Pipeboard × Meta", "Google Drive", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(intelSpec);
