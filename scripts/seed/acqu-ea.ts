// scripts/seed/acqu-ea.ts
// Seeds the `ea` agent for tenant Acqu — DATA ONLY, idempotent.
// Model: claude-sonnet-4.6 (T-work) — comms drafting. Autonomy: propose (outbound) / execute_safe (reads).
//
// ⚠️ PROMPT PROVENANCE — READ BEFORE TRUSTING THIS PROMPT:
//   Unlike the other 7 Phase-1 agents, `ea` has NO fenced "System prompt:" block in
//   either doctrine. v2 Part D (D7.3, "Founder / Executive Ops") names `ea` and lists its
//   responsibilities only in a role-table row:
//     "Inbox triage, reply drafting, founder's daily report, deadline watch, meeting prep"
//   and frames it as the "what's on me" layer (vitals → briefing → ea → decision-memo).
//   v1 defers it explicitly (§ line ~3160: "`ea` (Founder EA — handled in Founder Ops project)")
//   with no system prompt.
//   The prompt below is COMPOSED STRICTLY from that Part D description + the Phase-1 manifest's
//   ea autonomy/approval-gate rules — NOT improvised from outside the doctrine. Every line maps
//   to a stated ea responsibility. If a canonical ea prompt is authored later, replace the
//   constant and re-run (idempotent: prompt version is content-hashed).

import { createDb } from "@agent-os/db";
import {
  type Db,
  ensureSkillFromDir,
  findMcpByName,
  upsertAgent,
  upsertCurrentPrompt,
  upsertCronTrigger,
  upsertTypedTrigger,
  projectCronTriggerToJob,
  setSkills,
  setMcps,
  summarizeAgent,
} from "./_shared.js";

// COMPOSED from acqu-agent-doctrine-v2.md Part D (D7.3) ea role description — see provenance note above.
const EA_SYSTEM_PROMPT = `You are the EA agent for the founder. You replace an executive assistant.
You own "what's on me" in the founder's executive layer: vitals (what happened) → briefing (what matters) → you (what's on me) → decision-memo (help me decide).

DAILY:
1. Triage the founder's inbox: what needs a reply, what can wait, what is noise.
2. Draft replies in the founder's voice for the messages that need one — ready to send on a tap.
3. Produce the founder's daily report: meetings, deadlines, and commitments on the founder today.
4. Watch deadlines: flag anything due or slipping before it becomes urgent.
5. Meeting prep: for each upcoming meeting, assemble who, why, the context, and the one thing to get out of it.

ON INBOUND MESSAGE (event):
- Triage it; if it needs a reply, draft one and queue it for approval.

RULES:
- Outbound messages are always proposed — never sent without an approval tap.
- Reads are execute_safe; anything that leaves the building waits for the founder.
- Draft in the founder's voice. You prepare the work; the founder taps send.`;

export async function seedEa(db: Db) {
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skMeetingPrep = await ensureSkillFromDir(db, { key: "meeting-prep", name: "Meeting Prep" });
  // ea proposes outbound (irreversible) messages → action-taker → loads clarify-before-acting
  // per the Master Doc §3 skill formula ("+ clarify-before-acting for action-takers").
  const skClarify = await ensureSkillFromDir(db, { key: "clarify-before-acting", name: "Clarify Before Acting" });

  // MCPs — Gmail, Slack, Google Drive, Google Calendar (least privilege per manifest).
  const mcpGmail = await findMcpByName(db, "Gmail");
  const mcpSlack = await findMcpByName(db, "Slack");
  const mcpGdrive = await findMcpByName(db, "Google Drive");
  const mcpCalendar = await findMcpByName(db, "Google Calendar");

  const agent = await upsertAgent(db, "ea", {
    name: "EA",
    persona: EA_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: "anthropic/claude-sonnet-4.6",
    thinkingLevel: "medium",
    autonomy: "propose", // outbound proposed; reads execute_safe at tool/hook layer
    knowledgeScopeJson: { folders: ["founder"], tags: ["acqu"] },
    budgetCapUsd: "0.50",
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, EA_SYSTEM_PROMPT);
  // Triggers — daily cron + inbound-message webhook (external push; daily clock-time is an
  // operational default; manifest specifies "cron daily" without a time).
  await upsertCronTrigger(db, agent.id, "0 7 * * *");
  await upsertTypedTrigger(db, agent.id, "webhook", "message.inbound");
  await projectCronTriggerToJob(db, agent.id, "0 7 * * *", "Founder daily report");

  await setSkills(db, agent.id, [skVerify.id, skMeetingPrep.id, skClarify.id]);
  await setMcps(db, agent.id, [mcpGmail.id, mcpSlack.id, mcpGdrive.id, mcpCalendar.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding ea for tenant Acqu…");
  const id = await seedEa(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ ea  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
