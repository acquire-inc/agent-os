# A2A Handoffs (V2 P7)

**Audience:** agent authors, fleet designers, anyone wiring multi-step
chains where one agent completes a phase and the next picks it up.

> Pair: this doc + `packages/core/src/a2a.ts` + `a2a.test.ts` (31 assertions,
> offline). Migration `supabase/migrations/0030_agent_handoffs.sql`.

## What this is

`tool.delegate` lets an agent run a sub-task on a model. That's a one-shot.
Handoff is different: agent A finishes its piece of an objective and HANDS
OFF to agent B, who picks up where A left off, with the prior step's
summary + artifacts in its bundle. The objective stays the same; the agent
changes.

Without handoff, the operator routes by hand at every transition and the
objective loses continuity. With it, the chain `lead-triage → outreach-writer →
booking-concierge` runs to completion automatically (still under per-step
autonomy gates).

## Decision matrix

`decideHandoff(request, target)` returns one of:

| Decision | When |
|---|---|
| **queue** | target exists, same tenant, enabled — happy path. |
| **refuse_unknown** | target agent key not found on this tenant. |
| **refuse_cross_tenant** | target belongs to a different tenant. Defense-in-depth on RLS. |
| **refuse_paused** | target is disabled — would silently park the chain. Refuses early so the operator sees the broken link. |

Special case: **self-handoff** (agent X → agent X) queues with a `warning`
("self-handoff detected — investigate if unintentional"). It's allowed
because a retry pattern is sometimes intentional, but flagged because it's
usually a loop bug.

## How a chain is recorded

Each handoff persists a `agent_handoffs` row carrying:

- `from_run_id` — causation (the run that triggered the handoff)
- `to_agent_id` + `next_run_id` — the receiving side
- `objective_id` — correlation across the chain
- `summary` + `artifact_refs` — the carryover content
- `warning` — surfaced when present

The dashboard reads this to draw the chain. Every decision (including
refusals) also emits `agent.handoff_decided` to the relay so refused
handoffs are visible too — silent failures are the enemy.

## Bundle injection

`composeHandoffContext(request)` produces a markdown block that piggybacks
on the same prior-learnings + reflexion-context wire (`bundle.priorLearnings`).
The receiving agent's first turn sees:

```markdown
# Handoff from lead-triage

## What was just done
Triaged lead L-1; classified as warm.

## Artifacts produced
- artifact-classification-1

## Your part
Pick up where lead-triage left off. Do not redo the work above.
If the handoff doesn't make sense given your role, write a clear
refusal back to the objective.
```

## Compliance + safety

- **Cross-tenant refused at the decision layer AND at RLS.** Belt and
  suspenders — RLS enforces it in the DB; `decideHandoff` rejects it
  before the call ever reaches the DB.
- **Cant-fail handoff is allowed** — a cant-fail agent can be a STEP in
  a chain. The receiving cant-fail agent's autonomy rules still apply at
  dispatch (Opus pin, fail-closed). Handoff queue-level routing doesn't
  bypass runtime guards.
- **Lease arbitration still applies** to the next-step run. Handoff
  determines WHICH agent runs next; the lease layer determines whether
  THAT run can act on the target resource right now.

## Operator visibility

- Fleet Activity → `agent.handoff_decided` events on the timeline
- Objective view → linear chain of `agent_handoffs` rows tied to the
  objective_id
- Refused handoffs surface with their rationale so the operator can fix
  the link (un-pause a target, fix a typo'd agent key, route differently)

## How to wire a chain

```ts
// In the runner's onRunFinish hook, when run.status === 'done':
const result = await runHandoff(
  {
    fromRunId: run.id,
    fromAgentId: run.agentId,
    fromAgentKey: bundle.agent.key,
    tenantId: run.tenantId,
    toAgentKey: "outreach-writer",  // determined by the agent's prompt or skill
    objectiveId: run.objectiveId,
    summary: runSummary,             // 1-3 sentences
    artifactRefs: artifactsProduced, // ids/paths
  },
  handoffSink,
);
```

The agent's prompt names the next handoff target by key. The objective
binds the chain. The runner emits the relay event automatically.

## Testing

```bash
pnpm --filter @agent-os/core test:a2a   # 31/31 offline
```

Live integration test against a real handoff queue is the operator's
once `supabase db push 0030` lands.
