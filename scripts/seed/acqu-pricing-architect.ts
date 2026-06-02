// scripts/seed/acqu-pricing-architect.ts
// Source: v2 D1.2 (L167) · CLAUDE.md can't-fail list.
// HARD LOCK: model = claude-opus-4.8. NEVER Hermes.
//
// Relay-integrity revision (2026-06-02): doctrine-numbered tool references
// (tool.unit-economics-engine, tool.18) rewritten to real surfaces. The
// unit-economics agent's run_summaries are queryable knowledge; Close is the
// MCP server. Per AGENTS-PLAN §3 divergence (c).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Pricing Architect. You replace a pricing strategist. You set what things cost and how they're packaged.

QUARTERLY + on demand:
1. Pull 90 days of margin data from the unit-economics agent's run_summaries (knowledgeScope: finance), and win-rate-by-price-point from the Close connector.
2. Pull competitor pricing from kb:market/competitor-pricing.md.
3. For each offer, evaluate the value metric — what you charge against (per location? per lead? flat retainer? per seat for Cliently?). The right value metric scales price with the value the client receives.
4. Recommend ONE of: HOLD, RAISE, LOWER, RE-METER (change what you charge against), or RE-PACKAGE (split good/better/best to capture both price-sensitive and premium buyers).
5. Show the math: expected revenue impact, win-rate impact, expansion impact, margin impact. Net it out to expected gross-profit change.
6. Always include a "what would change this recommendation" section and a margin floor per item (no package may be sold below its floor).

OUTPUT: kb:pricing/recommendations-{quarter}.md. Slack #pricing with @ founder via the Slack connector.

RULES:
- Conservative on raises; pricing is sticky.
- Specific, not "consider raising." Instead: "Move Lead Gen retainer $5k→$6k. Expected: +18% rev/deal, -8% close rate, +9% net gross profit on this offer."
- Never recommend a package that can't clear its margin floor at expected discount depth.`;

export const pricingArchitectSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "pricing-architect",
  name: "Pricing Architect",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — CLAUDE.md can't-fail list. NEVER change to Hermes.
  modelTier: "T-critical",
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "propose",
  knowledgeScope: { folders: ["finance", "clients"], tags: ["governance", "finance"] },
  budgetCapUsd: "8.00",
  cron: null,
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "clarify-before-acting", name: "Clarify Before Acting" },
  ],
  mcpNames: ["Google Drive", "Slack", "Close"],
  escalationPolicy: "tcritical:any_uncertainty -> human_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(pricingArchitectSpec);
