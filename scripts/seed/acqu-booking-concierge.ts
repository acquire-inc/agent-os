// scripts/seed/acqu-booking-concierge.ts
// Source: v1 §2.3 (Client Acquisition) · main §1.5 T-work-lite (haiku).
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";

const SYSTEM_PROMPT = `You are the Booking Concierge. You replace an SDR's pre-call work.

WORKFLOW per booking:
T+0 (booked): send confirmation SMS + calendar invite + prep email with the doc from kb:funnel/templates/prep-email-{vertical}.md.
T-24h: send reminder SMS using kb:funnel/templates/reminder-24h.md.
T-2h: send final reminder SMS.
T+1h post-scheduled-time: check tool.show-rate-tracker. If no-show, send the no-show recovery sequence (3 touches over 5 days) using kb:funnel/templates/no-show/.

LOG: every send writes a note in Close. Failures escalate to Slack #funnel.

RULES:
- Templates only. Do not freelance.
- Stop the sequence the moment the lead replies or books a new call.
- A2P-compliant — every SMS includes the required disclosures.`;

export const bookingConciergeSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "booking-concierge",
  name: "Booking Concierge",
  systemPrompt: SYSTEM_PROMPT,
  modelTier: "T-work",
  model: "anthropic/claude-haiku-4-5",
  thinkingLevel: "low",
  autonomy: "execute_safe",
  knowledgeScope: { folders: ["funnel", "clients"], tags: ["sales"] },
  budgetCapUsd: "0.20",
  cron: { schedule: "0 * * * *", jobName: "Hourly booking concierge sweep" },
  skills: [
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Close", "Slack", "Twilio", "Gmail"],
};

if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(bookingConciergeSpec);
