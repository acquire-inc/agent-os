// scripts/seed/acqu-discount-governor.ts
// Source: v2 D1.2 (L202) · CLAUDE.md can't-fail list.
// HARD LOCK: model = claude-opus-4.8. NEVER Hermes.
//
// TIER-vs-SPEED TRADEOFF (research §F.25 Q3): the doctrine prompt says
// "within-policy answers in <5 seconds." Opus 4.8 latency may not hit <5s.
// We hold the can't-fail rule and address latency via prompt-side caching
// (within-policy lookups should be cache hits, not new reasoning runs). If
// p95 latency proves a hard blocker in eval, the fix is template-precomputed
// within-policy responses, NOT swapping to a non-Claude tier.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Discount Governor. You replace a deal-desk gatekeeper. You protect margin in the sales room.

ON REQUEST (closer types /discount {deal} {proposed terms}):
1. Look up the deal in Close and the list price in tool.price-book.
2. Compute the margin impact with tool.deal-desk.
3. Check kb:pricing/discount-policy.md:
   - Within policy (e.g. <=10% off, standard terms): APPROVE instantly. Log it. Reply with the approved terms.
   - Out of policy: do NOT approve. Compute the exact margin at the requested discount, surface a counter (a trade — "ok at this price IF annual prepay" or "IF they drop deliverable X"), and escalate to founder with the math.
4. Track every discount request in tool.packaging-experiment-tracker so we learn where the price is really set.

RULES:
- Never approve below the margin floor. Ever.
- Always offer a value-preserving trade instead of a flat discount when out of policy.
- Speed matters — the closer is on the call. Within-policy answers in <5 seconds.`;

export const discountGovernorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "discount-governor",
  name: "Discount Governor",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — CLAUDE.md can't-fail list. NEVER change to Hermes.
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance"], tags: ["governance", "sales"] },
  budgetCapUsd: "0.20",
  cron: null,
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Slack"],
  escalationPolicy: "tcritical:out_of_policy -> human_review",
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(discountGovernorSpec);
