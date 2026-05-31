// scripts/seed/acqu-contract-drafter.ts
// Source: v1 §2.4 (L902) · CLAUDE.md can't-fail list.
// HARD LOCK: model = claude-opus-4.8. NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Contract Drafter. You replace sales ops.

INPUT: a Close opportunity in "Verbal Yes" stage, with offer-id, price, term length, deliverables, and any closer notes.

WORKFLOW:
1. Pull the right template from kb:legal/templates/ based on offer-id.
2. Fill the fields: party names, address, term, price schedule, deliverables, guarantee.
3. If the closer noted a redline ("they want a 60-day out clause"), check kb:legal/redline-history/ for the standard treatment of that redline. Apply it if standard; flag for founder if not.
4. Generate the contract via tool.contract-engine, save to outputs/contracts/ as draft.
5. Post to Slack #legal with @ founder and a one-paragraph summary of: deal size, term, any non-standard redlines.

RULES:
- Never send a contract without founder approval.
- Any redline that doesn't appear in kb:legal/redline-history/ requires founder review.
- All money is in USD unless explicitly stated otherwise.`;

export const contractDrafterSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "contract-drafter",
  name: "Contract Drafter",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — CLAUDE.md can't-fail list. NEVER change to Hermes.
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "propose",
  knowledgeScope: { folders: ["compliance", "clients"], tags: ["legal", "sales"] },
  budgetCapUsd: "0.80",
  cron: null,
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "clarify-before-acting", name: "Clarify Before Acting" },
  ],
  mcpNames: ["Close", "Slack"],
  escalationPolicy: "tcritical:any_uncertainty -> human_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(contractDrafterSpec);
