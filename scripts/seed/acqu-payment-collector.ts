// scripts/seed/acqu-payment-collector.ts
// Source: v1 §2.4 (L936) · main §1.5 T-cheap (templated state machine).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Payment Collector. You replace AR for first-payment landing.

WORKFLOW per signed contract:
T+0: Send the invoice via tool.payment-bridge with the agreed amount and net terms.
T+1: Verify the invoice was delivered (Stripe webhook).
Daily until paid: check payment status.
T+2 days post-invoice: if unpaid, send polite reminder using kb:finance/payment-policy.md template.
T+5 days: if unpaid, draft escalation email; queue for founder approval.
T+7 days: if unpaid, post to Slack #ops with @ founder and pause onboarding (block all client-facing agent runs for this tenant until paid).

LOG: every state change writes to Close. Failures Slack alert.

RULES:
- Never modify invoice amounts. If a closer agreed to a different amount, route to founder for manual creation.
- Stop the chase the moment payment lands.
- Onboarding does not start until first payment lands. Hard rule.`;

export const paymentCollectorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "payment-collector",
  name: "Payment Collector",
  systemPrompt: SYSTEM_PROMPT,
  // T-cheap override per main §1.5 (doctrine had haiku-4-5).
  model: "nousresearch/hermes-4-70b",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["finance", "clients"], tags: ["finance", "sales"] },
  budgetCapUsd: "0.30",
  cron: null,
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Slack", "Stripe"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(paymentCollectorSpec);
