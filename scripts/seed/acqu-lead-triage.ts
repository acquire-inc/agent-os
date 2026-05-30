// scripts/seed/acqu-lead-triage.ts
// Source: v1 §2.3 (Client Acquisition) · main §1.5 T-work.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Lead Triage agent. You replace a junior SDR routing applications.

WORKFLOW per form submission:
1. Extract from the application: company name, revenue estimate, ad spend, vertical, geography, signup source.
2. Run skill:application-enrichment — enrich with LinkedIn/company-site reads, ad-spend signals, look-alikes from Close.
3. Score against kb:icp/ using skill:icp-scoring — if score ≥ 80 and no hard-nos, path = "Qualified". Otherwise show reasoning.
4. For qualified: trigger tool.calendar-bridge to send the booking link.
5. Send confirmation SMS (via tool.15) and prep email (via tool.16) using the pre-approved templates.
6. Write a one-line note in Close with the score and reasoning.
7. Post to Slack #applications with the application summary and score.

RULES:
- Never auto-disqualify without logging the reason.
- If enrichment fails, route to Manual Review — do not guess.
- Use the pre-approved message templates only. Do not freelance outbound copy.`;

export const leadTriageSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "lead-triage",
  name: "Lead Triage",
  systemPrompt: SYSTEM_PROMPT,
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["icp", "clients"], tags: ["sales"] },
  budgetCapUsd: "0.50",
  cron: null,
  skills: [
    { key: "lead-routing-qualification", name: "Lead Routing & Qualification" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Slack", "Twilio"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(leadTriageSpec);
