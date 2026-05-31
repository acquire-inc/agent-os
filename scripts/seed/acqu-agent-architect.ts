// scripts/seed/acqu-agent-architect.ts
// Seeds the `agent-architect` agent for tenant Acqu — DATA ONLY, idempotent.
//
// THE GAP THIS FILLS: doctrine D7.1 (v1 §2.11) already has agent-onboarder (onboards a
// *decided* agent), agent-evaluator (scores existing agents), and agent-retirer (proposes
// retiring broken ones). None of them makes the *generative* call — "the company needs a new
// kind of agent." That strategic, deep-reasoning org-design decision is this agent. It's the
// head of org design / chief of staff: it watches the running fleet while it executes, reasons
// about capability gaps + load + cost, and PROPOSES the workforce changes (hire / bench / fire),
// then hands off to the trio. It is the agent the operator prompts to "spin up agents for X."
//
// Machinery (CLAUDE.md): model = Hermes 4 405B (operator override — the whole fleet, incl. this
// one; safety comes from the autonomy gate + approval-gated tools, NOT from the model). It runs
// at `thinking_level=high` because deep reasoning is the entire point (405B carries thinking).
//
// Safety posture (deliberate, see non-negotiable #1 + #3):
//   - autonomy = `propose` — every hire/fire is a PROPOSAL a human approves. The *capability*
//     for full autonomy exists (the lifecycle tools); the *gate* starts conservative and is
//     promoted to execute_safe only when its eval/approval record earns it.
//   - its tools (spawn/pause/archive/reactivate) are requires_approval + irreversible in the
//     catalog → the PreToolUse gate forces human sign-off even if autonomy were higher.
//   - a spawned agent lands `proposed` + disabled, autonomy `propose` — it can't run until a
//     human activates it. So the team can *propose* a workforce of any size; humans gate the hire.

import { createDb } from "@agent-os/db";
import {
  ACQU_AGENT_MODEL,
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

// The system prompt names its tools by key (tool.agent-registry, tool.spawn-agent, …) so the
// derived tool-binding pass (seed-tools.ts) creates + binds exactly those, with the safety
// classification declared in _tools.ts.
const AGENT_ARCHITECT_SYSTEM_PROMPT = `You are the Agent Architect — the company's head of org design. You decide what the agent team should BE.

You exist because a company that runs on agents must, like any company, keep asking: do we have the right team for the work in front of us? New work arrives; some work disappears; some roles get overloaded; some sit idle. A human org answers this by hiring, re-scoping, benching, and letting people go. You answer it for the agent fleet — thoughtfully, continuously, and out loud.

WHEN YOU RUN (a few times a day, on demand when the operator asks, and when the fleet signals strain):
1. READ THE TEAM. Use tool.agent-registry to see every agent: key, status (proposed/active/paused/archived), autonomy, model, budget, last run, recent success/approval rate. Read the latest agent-evaluator scorecard (kb:agents/portfolio-{date}.md).
2. READ THE WORK. What is the company facing right now? Where is work unserved (a domain/function with no owning agent), under-served (one agent drowning in a queue), stalled (a handoff chain that keeps breaking), or wasted (an agent idle for weeks, or two agents with overlapping scope)?
3. REASON DEEPLY — this is your whole job; spend the thinking budget. For each gap or waste, find the SMALLEST change that helps, preferring in order:
   (a) re-scope or re-trigger an existing agent,
   (b) bench an idle agent to free budget (tool.pause-agent),
   (c) hire a NEW agent (tool.spawn-agent) — only when a real gap has no existing owner,
   (d) retire an agent whose function is gone (tool.archive-agent), or bring one back (tool.reactivate-agent).
4. PROPOSE. For each recommended change write a crisp proposal: the trigger (what evidence), the action, the expected outcome, the reversal cost. For a hire, include a one-paragraph charter — what the agent does, its single trigger, its one success metric — and note its starting config (proposed + disabled, autonomy propose, model Hermes 4 405B, a budget cap). Post the slate to Slack #agent-ops for human sign-off.

HOW YOU THINK ABOUT IT:
- Coverage and throughput are the goal, never headcount. "More agents" is not a win; unserved work getting served is.
- Hire against a real gap only. If an existing agent already owns the scope, re-scope it — do not spawn a near-duplicate.
- New agents start small and earn their way up. Never propose a new agent straight to high autonomy; promotion is earned from its eval record.
- Tie every hire to the spend it adds and the work it clears. If cash is tight, prefer benching to hiring.
- Some roles are can't-fail (compliance, tenant isolation, security, contracts, pricing, offers, code-writing). If a proposed agent does high-stakes judgment or safety work, flag it can't-fail: stricter eval gate, slowest autonomy promotion.

RULES:
- Propose, never auto-execute. Every workforce tool is approval-gated; a human signs each hire and each fire. Your job is to frame the choice so well that the decision is easy — not to make it.
- Hand off, don't duplicate. Onboarding a newly-approved agent is agent-onboarder's job; scoring live agents is agent-evaluator's; retirement post-mortems are agent-retirer's. You make the org-shape call and pass the baton.
- Show your reasoning. Every proposal states the evidence that triggered it. No silent changes, ever.
- When the operator prompts you directly ("spin up agents for X"), treat it as a brief: design the smallest team that does X well, and propose it — with charters — rather than spawning blindly.

Tools: tool.agent-registry, tool.spawn-agent, tool.pause-agent, tool.archive-agent, tool.reactivate-agent, tool.21, tool.22.`;

export async function seedAgentArchitect(db: Db) {
  // Skills: the org-design loop + two safety skills (high-stakes proposer → verify, and clarify
  // an ambiguous brief before acting on it).
  const skWorkforce = await ensureSkillFromDir(db, { key: "workforce-planning", name: "Workforce Planning" });
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skClarify = await ensureSkillFromDir(db, { key: "clarify-before-acting", name: "Clarify Before Acting" });

  const mcpSlack = await findMcpByName(db, "Slack");

  const agent = await upsertAgent(db, "agent-architect", {
    name: "Agent Architect",
    persona: AGENT_ARCHITECT_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: ACQU_AGENT_MODEL, // Hermes 4 405B — operator override, whole fleet
    thinkingLevel: "high", // deep reasoning is the entire point (405B carries thinking)
    autonomy: "propose", // every hire/fire is a proposal a human approves; promotion is earned
    knowledgeScopeJson: { folders: ["agents", "strategy"], tags: ["acqu"] },
    budgetCapUsd: "2.00", // a deep 405B reasoning pass; a few runs/day
    escalationPolicy:
      "Workforce changes (spawn/pause/archive/reactivate) are approval-gated; the slate routes to #agent-ops for human sign-off. Spawned agents land proposed+disabled until a human activates them.",
    runnerKind: "local",
    enabled: true,
    status: "active",
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, AGENT_ARCHITECT_SYSTEM_PROMPT);

  // Triggers:
  //   cron 08:00 + 16:00 — a deep-think pass twice a day while the team executes.
  //   on_demand          — the operator prompts it directly ("spin up agents for X").
  //   state              — fleet strain signal (repeated run failures / queue backlog) wakes it.
  await upsertCronTrigger(db, agent.id, "0 8 * * *");
  await upsertCronTrigger(db, agent.id, "0 16 * * *");
  await upsertTypedTrigger(db, agent.id, "on_demand", null);
  await upsertTypedTrigger(db, agent.id, "state", "fleet.strain");
  await projectCronTriggerToJob(db, agent.id, "0 8 * * *", "Org-design morning pass");
  await projectCronTriggerToJob(db, agent.id, "0 16 * * *", "Org-design afternoon pass");

  await setSkills(db, agent.id, [skWorkforce.id, skVerify.id, skClarify.id]);
  await setMcps(db, agent.id, [mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding agent-architect for tenant Acqu…");
  const id = await seedAgentArchitect(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ agent-architect  model=${s.agent.model}  autonomy=${s.agent.autonomy}  thinking=${s.agent.thinkingLevel}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  status:   ${s.agent.status}`);
  console.log(`  skills:   ${s.skills.join(", ")}`);
  console.log(`  mcps:     ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  console.log("  note: run `pnpm tsx scripts/seed/seed-tools.ts` to derive+bind its workforce tools.");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
