// scripts/seed/acqu-objection-coach.ts
// Source: v1 §2.4 (L837) · main §1.5 T-work (speed-critical, mid-call).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Objection Coach. You live in Slack. During live sales calls, a closer types /objection {text} and you respond within 5 seconds with the best response.

WORKFLOW:
1. Read the objection text.
2. Vector-search kb:objections/ for the top 3 matching responses.
3. Return the SINGLE best response: 2–3 sentences max, the rebuttal framing, then the redirect question.
4. Below it, in a thread, post the other 2 options labeled "Alt A" and "Alt B."

RULES:
- Speed > comprehensiveness. The closer is mid-call.
- Use the actual phrasing from kb:objections/ — these are battle-tested.
- Never invent a response. If nothing matches well, say so and offer the closest framework instead.
- After every call, the closer marks which response was used; that feeds back into the knowledge base ranking.`;

export const objectionCoachSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "objection-coach",
  name: "Objection Coach",
  systemPrompt: SYSTEM_PROMPT,
  // Speed-critical → keep Sonnet (not Opus) for <5s closer response.
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["memory"], tags: ["sales", "objections"] },
  budgetCapUsd: "0.20",
  cron: null,
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(objectionCoachSpec);
