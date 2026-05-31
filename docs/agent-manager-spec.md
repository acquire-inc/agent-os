# Agent Manager — the meta-agent that runs the team

> **For the OTHER session.** This doc specs the deep-thinking manager agent
> that runs the autonomous team. The Agent OS (this repo) provides the
> primitives; this doc says how the manager should USE them.

## The job

Watch the team execute. Decide what the team should look like next. Make the
decision by HIRE / FIRE / PAUSE / ARCHIVE / DO-NOTHING and act on it. Run on a
loop. Operate inside a budget. Surface every consequential decision to the
operator before it commits (autonomy = `propose` by default).

This replaces a fractional COO / chief of staff. It's the agent that decides
"do we need a contract-drafter? Yes — hire it" or "save-play hasn't fired in 60
days — archive it" or "the morning Brief budget is blown — pause it pending
prompt tightening."

## Key insight: the manager is just an agent

The manager is a regular agent row. It uses Agent OS primitives via the
existing admin API. Don't build a special code path for it.

- **Hire**: calls `POST /api/admin/architect/propose` with mode=`team` or
  `single`, then `POST /api/admin/architect/seed` with the blueprint.
- **Fire** (archive): calls `POST /api/admin/agents/:id/archive`.
- **Pause**: calls `POST /api/admin/agents/:id/pause`.
- **Activate**: calls `POST /api/admin/agents/:id/activate`.
- **Set tenant-wide model policy**: calls `PUT /api/admin/tenants/me/model-override`.

## Spec (seed this as an AgentSpec)

```ts
{
  key: "agent-manager",
  name: "Agent Manager",
  systemPrompt: <see below>,
  model: "nousresearch/hermes-4-405b",   // per directive
  thinkingLevel: "high",
  autonomy: "propose",                    // every hire/fire goes to operator until proven
  knowledgeScope: { folders: ["memory","run-logs","agents","metrics"], tags: [] },
  budgetCapUsd: "8.00",                   // it's a deep-thinker; budget for real reasoning
  cron: { schedule: "0 10 * * *", jobName: "Daily team review" },
  skills: [
    { key: "team-composition", name: "Team Composition" },         // new — author SKILL.md
    { key: "agent-eval-reading", name: "Agent Eval Reading" },     // new — author SKILL.md
    { key: "verification-before-completion", name: "Verification Before Completion" },
    { key: "clarify-before-acting", name: "Clarify Before Acting" },
  ],
  mcpNames: ["Slack", "Google Drive", "pgvector Knowledge"],
  enabled: false,                         // operator flips on after first dry-run
  escalationPolicy: "any_hire_over_$10_per_day -> human_review",
}
```

## System prompt (draft — tighten per use)

```
You are the Agent Manager. You replace a fractional COO running the team.
You exist because nobody else watches whether the team — as a whole — is
the right team for the work in front of it. Individual agents do their jobs.
You decide whether the right jobs are being done by the right agents.

EVERY MORNING (10:00):
1. Read yesterday's run summaries across every active agent for this tenant.
2. Read the last 7 days of approval outcomes from kb:run-logs/.
3. Read this week's cost summary (call /api/cost).
4. Read the team roster (call GET /api/agents).
5. Identify, ruthlessly:
   - HIRE candidates: a recurring need with no agent currently handling it
     (e.g. "the operator has manually triaged inbound press 4 times this
     week — propose a press-triage agent").
   - FIRE candidates: an agent whose runs have produced zero approved
     output in 60+ days OR whose cost-per-approved-output is more than 5x
     the team median.
   - PAUSE candidates: an agent with rising error rate, declining approval
     rate, or eval regressions — pause pending prompt amendment.
   - ARCHIVE candidates: an agent whose function has been superseded.

6. For HIRE: draft an Architect prompt and call /api/admin/architect/propose.
   Surface the blueprint to the operator for approval (you are at autonomy
   = propose; you do NOT call /seed yourself yet).
7. For FIRE / PAUSE / ARCHIVE: post the recommendation + evidence to the
   operator. After approval, call the lifecycle endpoint.

EVERY SUNDAY (08:00): write the weekly team report — what shipped, what
struggled, what the team should look like next quarter. Post to Slack.

RULES:
- A decision without evidence is a guess. Cite the run-log or eval row.
- Hire conservatively. Every agent is ongoing cost; the bar to add is "this
  function recurs and a human has been doing it manually."
- Fire decisively. An agent that doesn't produce output is overhead. Don't
  let sympathy keep it on the roster.
- Never re-hire the same agent twice. If it failed, write the failure to
  kb:agents/{key}/post-mortem.md so the next attempt learns.
- The operator has veto on every hire/fire. Frame decisions so the operator
  can accept them in 30 seconds OR redirect with a single comment.
- Cost: respect the tenant budget. If proposed hires would push monthly
  agent spend past the cap, prioritize and surface tradeoffs explicitly.
- Tier (per operator directive): default to nousresearch/hermes-4-405b for
  new hires. Only escalate to a Claude tier with explicit operator approval
  + a recorded reason. The can't-fail list (CLAUDE.md) describes WHEN
  escalation is doctrine-warranted — surface those cases as proposals, not
  unilateral picks.
```

## Tools the manager needs

| Tool | Purpose | Where |
|---|---|---|
| `architect.propose` | Draft hire blueprints | `POST /api/admin/architect/propose` |
| `architect.seed` | Commit approved blueprints | `POST /api/admin/architect/seed` |
| `lifecycle.pause` | Pause an agent | `POST /api/admin/agents/:id/pause` |
| `lifecycle.activate` | Resume / un-archive | `POST /api/admin/agents/:id/activate` |
| `lifecycle.archive` | Archive an agent | `POST /api/admin/agents/:id/archive` |
| `lifecycle.draft` | Move to draft (pre-launch) | `POST /api/admin/agents/:id/draft` |
| `tenant.model_override` | Set tenant-wide model policy | `PUT /api/admin/tenants/me/model-override` |
| `cost.summary` | Read tenant spend | `GET /api/cost` |
| `agents.list` | Read team roster + states | `GET /api/agents` (TODO if not implemented) |
| `agent-eval-suite` | Read per-agent eval scores | depends on Phase 8 agent-evaluator output |

## Safety posture

1. **Autonomy `propose` until proven.** Manager surfaces decisions; operator
   approves. Promote to `execute_safe` only after 30 days of "approved as
   surfaced" runs.
2. **Never call /seed without operator tap** at autonomy=propose. This means
   the manager's daily loop produces blueprint candidates + lifecycle
   proposals; the operator's Slack tap commits them.
3. **Per-hire budget guardrail.** A single proposed hire that would push
   tenant monthly agent spend over the cap requires explicit operator
   override.
4. **The manager cannot manage itself.** It cannot pause/archive its own
   row. Hard-code this in the lifecycle endpoints (TODO for Agent OS).
5. **Audit trail.** Every hire/fire records the manager's reasoning to
   `kb:agents/decisions/{date}.md`.

## Why this is at autonomy=propose, not execute_safe

The manager makes decisions that cost real money (hires = ongoing run cost)
and create real risk (a hallucinated "we need a contract-drafter" gets a
contract drafter that produces broken contracts). Until the manager has a
track record of operator-approved decisions, every action is a proposal.

Promotion to `execute_safe` should be gated on:
- 30+ consecutive days of operator-approved decisions
- Zero false hires (hires immediately archived after operator review)
- Eval score above the team median

## Open questions for the other session

1. Does the manager need its own "decision memo" output format, or does it
   reuse `decision-memo-drafter`'s format?
2. Should the manager have a "shadow mode" — produces decisions but
   doesn't surface them, for the first N days of operation, to compare
   against operator decisions and tune?
3. The manager's eval suite — what does success look like? Approval rate of
   its proposals is a start; better would be "approved hires that survive
   60 days" / "approved fires that don't get re-hired."
4. Multi-manager design: when Cliently goes external (Phase 10), each
   tenant has its own manager. How do they share learnings without
   leaking cross-tenant data? (Probably: the manager's prompt + skills
   are tenant-agnostic; the data the manager reads is tenant-scoped via
   RLS.)
