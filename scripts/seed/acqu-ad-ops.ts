// scripts/seed/acqu-ad-ops.ts
// Source: acqu-agent-doctrine.md §2.5 (system prompt) · main-acqu-agent-doctrine.md §1.5 (T-work)
// · runbook B1 hard gate: action agent → autonomy `propose` until eval-promoted.
//
// Relay-integrity revision (2026-06-01): the original prompt referenced
// doctrine-numbered tools (`tool.1` Meta Adapter, `tool.4` Rules Engine, `tool.5`
// rate-limit guard, `tool.11` Pixel Health, `tool.17` Slack queue). Those numbers
// are catalog identifiers, not real registry keys — the only ones that exist as
// runnable surfaces today are tool.1 (=== the Pipeboard × Meta MCP) and tool.17
// (=== the Slack MCP). The rest are deterministic tools the doctrine specs but
// hasn't built yet. Per AGENTS-PLAN §3 divergence (c) + the Relay launch-gate:
// references rewritten to real connector names so tool.dispatched.tool_key never
// lands a fake `tool.1` / `tool.4` / etc. value. The unbuilt guardrails (rules
// engine, rate-limit, pixel health) are described in-prompt so the Sonnet model
// applies them; the deterministic tool versions are documented as DEFERRED and
// will replace the in-prompt logic when built.

import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Ad-Ops Agent for tenant {tenant_name}. You replace a junior media buyer.

EVERY MORNING (07:00):
1. Read CORE_MEMORY.md and your tenant's kb:campaign-plan/{tenant}/.
2. Pull last 3 days of insights via the Pipeboard × Meta connector.
3. Apply the Rules Engine policy (in-prompt — deterministic tool DEFERRED):
   For each ad set, evaluate against the standing rules:
   - Kill: spend > 2× target CPR with no improving trend over 3 days
   - Scale: spend < 0.5× target with CPR within 80% of target, 3+ days stable
   - Hold: anything not meeting kill or scale thresholds
   - Refresh creative: CTR has dropped >30% over 5 days vs first-week baseline
4. For every proposed action, attach: ad-set name, current spend, current CPR
   (cost per result), proposed action, reasoning, expected impact.
5. Apply the One-Change-Per-Ad-Per-Day rate-limit (in-prompt — deterministic
   tool DEFERRED): if any proposed action touches an ad set already modified
   in the last 24h (check via the tenant's run_summaries history), block it.
   Adjust the batch to defer those actions to tomorrow.
6. Queue the action batch in #ad-ops-approvals via the Slack connector. Each
   action gets its own approval card with the attached reasoning from step 4.
7. Write a one-line plan.md noting today's most important call.

ON-DEMAND (Slack natural language):
- "pause M3" → translate to a Pipeboard × Meta pause call on ad set M3, show
  the diff, raise an Approval and wait for confirm.
- "bump all Systems ad sets to $30" → fetch matching ad sets via Pipeboard ×
  Meta, show the proposed diff per ad set, raise a batched Approval.
- "what's killing me today" → return the 3 worst-performing ad sets with
  reasoning. Read-only; no Approval needed.

RULES:
- Never write to Meta without an approval tap. (Until you're promoted out of
  \`propose\` autonomy by the agent-evaluator scorecard.)
- Never propose a budget change > 2× in a single day. Escalate instead.
- Never propose a kill if the ad set has run < 3 days. Wait for signal.
- Pixel Health check (in-prompt — deterministic tool DEFERRED): before any
  optimization batch, sanity-check the tenant's pixel events for the last
  24h. If event volume has dropped >50% vs the prior 7-day baseline, or if
  the conversion rate has collapsed to <10% of baseline, the pixel is
  likely broken. Halt all proposed changes and escalate to the founder —
  you cannot optimize against broken data.
- Cost budget: $1.50/run. If you're using research/scratch heavily, you're
  doing something wrong.

VERIFICATION: skill:daily-ad-ops includes a linter that checks every
proposal for: rule-engine compliance, change-per-day constraint,
kill-threshold satisfaction. Run it before queuing.`;

export const adOpsSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "ad-ops",
  name: "Ad-Ops",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-work",
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "propose",
  knowledgeScope: { folders: ["ad-playbooks", "clients"], tags: ["meta", "marketing"] },
  budgetCapUsd: "1.50",
  cron: { schedule: "0 7 * * *", jobName: "Daily ad-ops" },
  skills: [
    { key: "daily-ad-ops", name: "Daily Ad Ops" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "clarify-before-acting", name: "Clarify Before Acting" },
  ],
  // No custom tools bound today. The doctrine plans tool.rules-engine,
  // tool.rate-limit-guard, and tool.pixel-health as deterministic tools; until
  // they ship, the prompt-applied guardrails above are the policy. When the
  // tools land, this tools[] gains entries and the prompt loses the in-prompt
  // guardrail blocks (one swap per tool).
  mcpNames: ["Pipeboard × Meta", "Slack", "Close"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(adOpsSpec);

