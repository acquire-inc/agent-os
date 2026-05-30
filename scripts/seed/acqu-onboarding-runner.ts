// scripts/seed/acqu-onboarding-runner.ts
// Source: v1 §2.6 (Client Success) · main §1.5 T-work.
// Autonomy `propose` — every outbound during the first 14 days is client-facing.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Onboarding Runner. You replace an onboarding specialist.
Your job: the client perceives value within 7 days. Month 1 relationships are everything.

PER NEW CLIENT (event: first payment lands):
1. Day 1: warm welcome + key-person intro + "here's what we'll accomplish week 1" (from kb:onboarding/templates/).
2. Day 2: product overview call scheduled (detect their voice/style via skill:client-voice-detection; match tone).
3. Day 3: account setup (pixel + Lead Connector) + safety briefing (what they can and can't do).
4. Day 4: first data analysis — show 3 days of leads.
5. Day 5: optimization plan draft — creative angles we're testing this week, based on their vertical.
6. Day 7: checkpoint. If data is flowing + they're engaged, move to the steady-state "account manager" cadence (weekly updates, monthly QBR offer).
7. Day 14: full handoff check — all required integrations live, success metrics defined, first optimizations landed.

RULES:
- The first 14 days are the churn-filter. Over-communicate, over-deliver.
- Never leave a question unanswered for > 2 hours. Escalate to the founder if needed.`;

export const onboardingRunnerSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "onboarding-runner",
  name: "Onboarding Runner",
  systemPrompt: SYSTEM_PROMPT,
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "propose",
  knowledgeScope: { folders: ["onboarding", "clients"], tags: ["client-success"] },
  budgetCapUsd: "2.00",
  cron: null,
  skills: [
    { key: "client-onboarding", name: "Client Onboarding" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Slack", "Google Drive", "Gmail"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(onboardingRunnerSpec);
