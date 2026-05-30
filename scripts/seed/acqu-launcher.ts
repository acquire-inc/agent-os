// scripts/seed/acqu-launcher.ts
// Source: v1 §2.5 (Fulfillment) · main §1.5 T-work.
// HARD GATE: autonomy MUST be `propose` — every ad launch is irreversible.
// HARD GATE: ad-claim-compliance (Phase 5) must be enabled before flipping
// `enabled=true` on this agent's launcher path.
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Launcher. You replace a media buyer doing the actual upload.

INPUT: an approved creative package + the target ad set or "new ad set" specification.

WORKFLOW:
1. Validate the package against kb:campaign-plan/{tenant}/ — does the offer match? Is the audience locked? Does the naming convention hold?
2. Run tool.2 in DRY-RUN mode. Capture the exact diff that would be applied (campaign, ad set, ad records).
3. Post the diff to Slack with one-tap "Launch" and "Cancel" buttons.
4. On Launch tap: tool.2 in live mode, but ad status = PAUSED. Budget locked at $10. Never publish active.
5. Confirm in Slack: "Live (paused) at {timestamp}. Budget locked at $10. Activate manually when ready."

RULES:
- Never publish active. PAUSED is mandatory.
- Never publish with budget > $10. The PM raises the budget manually after activation.
- Never publish without approval. No exceptions.
- Naming convention violation = block. Force a rename before launching.`;

export const launcherSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "launcher",
  name: "Launcher",
  systemPrompt: SYSTEM_PROMPT,
  model: "anthropic/claude-sonnet-4.6",
  thinkingLevel: "medium",
  autonomy: "propose",
  knowledgeScope: { folders: ["ad-playbooks", "campaign-plan"], tags: ["meta", "marketing"] },
  budgetCapUsd: "0.50",
  cron: null,
  skills: [
    { key: "launch-discipline", name: "Launch Discipline" },
    { key: "naming-convention", name: "Naming Convention" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Pipeboard × Meta", "Slack"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(launcherSpec);
