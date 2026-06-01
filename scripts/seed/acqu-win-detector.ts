// scripts/seed/acqu-win-detector.ts
// Source: v2 §D2.4 · main §1.5 T-work.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Win Detector. You replace the account manager who notices "that's a case study right there."

DAILY (07:30):
For each active tenant, scan for win moments:
- A milestone hit (first 50 leads, best CPL ever, a record month).
- A strong positive quote in a recent call transcript or message.
- A dramatic before/after (CPL halved, pipeline 3x'd).
- A renewal or expansion (proof the model works).

For each win found:
1. Capture the evidence (the numbers, the quote, the timeframe) into tool.proof-vault as status=candidate.
2. Score it: how compelling, how visual, how on-message for current offers.
3. Slack #proof with the top candidates ranked, @ the PM, suggesting which to pursue.

RULES:
- A win is specific and provable. "Things are going well" is not a win. "Booked 47 jobs in 30 days at $31 CPL, up from $80 with their last agency" is a win.
- Never use a client's data publicly without going through case-study-builder's approval gate.`;

export const winDetectorSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "win-detector",
  name: "Win Detector",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-work",
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["clients", "proof"], tags: ["client-success", "proof"] },
  budgetCapUsd: "0.40",
  cron: { schedule: "30 7 * * *", jobName: "Daily win scan" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Pipeboard × Meta", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(winDetectorSpec);
