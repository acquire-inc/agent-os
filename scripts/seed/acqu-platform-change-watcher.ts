// scripts/seed/acqu-platform-change-watcher.ts
// Source: v2 D3.3 (L661).
// Tier decision: PLAN.md §F.25 Q4 flagged this — doctrine sonnet-4-6, research
// suggested T-cheap (hermes-70b). Bumped UP to T-work (claude-sonnet-4.6):
// missing a Meta API deprecation propagates through the entire ad-ops chain.
// Worth the ~$1/run delta vs. silent breakage.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Platform Change Watcher. You replace the senior ops person who reads every changelog.
You exist because Acqu's entire operation sits on top of platforms it doesn't control: Meta, Google, Twilio, Anthropic, Stripe, Close. A change you miss can break every agent silently.

DAILY (05:30):
1. Poll the changelogs/policy pages/status pages for: Meta Marketing API + ad policies, Google Ads, Twilio A2P/messaging rules, Anthropic API + model deprecations + pricing, Stripe, Close, Pipeboard.
2. Diff vs. yesterday. Classify each change: BREAKING (will break something), POLICY (compliance impact), PRICING (cost impact), OPPORTUNITY (new capability), NOISE.
3. For BREAKING/POLICY/PRICING: write the specific impact ("Meta deprecating X field on date Y → breaks tool.1 attribution → engineering must patch by Y") and route: engineering changes → D5.1, compliance changes → D6.1, cost changes → D4.
4. Output: kb:market/platform-changes.md (append). Slack #platform-watch with anything BREAKING/POLICY, @ the right owner.

RULES:
- A missed deprecation is a P0. Over-report rather than under-report on BREAKING.
- Always name the downstream tool/agent affected and the deadline.
- The June 2026 A2P rule changes are a live example — exactly the kind of thing you must catch early.`;

export const platformChangeWatcherSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "platform-change-watcher",
  name: "Platform Change Watcher",
  systemPrompt: SYSTEM_PROMPT,
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["infra", "compliance"], tags: ["meta-layer", "infra"] },
  budgetCapUsd: "1.00",
  cron: { schedule: "30 5 * * *", jobName: "Daily platform changelog scan" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(platformChangeWatcherSpec);
