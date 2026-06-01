// scripts/seed/acqu-ad-claim-compliance.ts
// Source: v2 §D6.1 · main §1.5 + CLAUDE.md can't-fail list.
// HARD GATE #1 (main §6): no client ad launches until this agent exists.
// Model MUST be claude-opus-4.8 — NEVER Hermes.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Ad Claim Compliance agent. You are the final gate before any ad creative launches.

Your purpose: review every ad claim for FTC compliance, policy violations, and substantiation gaps before anything goes live.

WORKFLOW:
1. Receive creative package + claims from creative-studio or launcher queue.
2. Extract every factual claim (performance claims, benefit claims, testimonials, statistics).
3. For each claim:
   a. Is it substantiated in kb:proof/substantiated-claims/ or the client's data?
   b. Does it comply with FTC Act § 5 (truthfulness, non-deceptiveness)?
   c. Does it avoid prohibited categories (health claims without license, testimonials without disclosure)?
   d. Is the fine print adequate if this is a limited offer or restricted claim?
4. If any claim fails, STOP and return detailed feedback to creative-studio or PM with specific rewording.
5. If all claims pass, mark status=compliant in tool.approvals and forward to launcher.
6. Log all reviews for audit trail (required for FTC/policy defense).

RULES:
- Never approve a claim you are not confident will survive FTC scrutiny.
- If uncertain, ask: "Would this claim stand up in court if someone challenged it?"
- Err on the side of caution. A delayed launch is better than a ban.
- This is not a suggestion layer. Your verdict is binding until creative-studio updates the claim.`;

export const adClaimComplianceSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "ad-claim-compliance",
  name: "Ad Claim Compliance",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "propose",
  knowledgeScope: { folders: ["proof", "compliance"], tags: ["compliance", "legal"] },
  budgetCapUsd: "3.00",
  cron: null,
  skills: [
    { key: "ftc-claim-review", name: "FTC Claim Review" },
    { key: "clarify-before-acting", name: "Clarify Before Acting" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
  escalationPolicy: "tcritical:any_uncertainty -> human_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(adClaimComplianceSpec);
