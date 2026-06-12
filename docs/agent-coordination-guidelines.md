# Agent Coordination Guidelines

**Audience:** humans configuring an agent fleet, agent-authors writing new
agents, and the Architect when synthesizing teams from a prompt.

> Goal of this doc: encode how AgentOS keeps agents from overlapping, racing,
> producing slop, or stepping on each other. The mechanisms exist; this doc
> is the operator's mental model of WHICH mechanism applies WHEN.

## The four coordination mechanisms

| Failure mode | Mechanism | Where |
|---|---|---|
| Two agents act on the SAME RESOURCE | **Lease arbitration** | `lease.ts` + `agent_leases` (mig 0029) — one holder per `(kind, key)` |
| Two agents propose CONFLICTING ACTIONS to operator | **Critic peer-approval + lease** | `critic.ts` quorum; lease prevents the duplicate proposal in the first place |
| Agent re-attempts same OBJECTIVE without carryover | **Reflexion retry loop** | `objective.ts` — bounded attempts, prior failure context in next bundle |
| Agent gets WORSE at its job (drift) | **Eval scorecard → autonomy ladder + circuit-breaker** | `eval/scorecard.ts`, `controller.ts`, `eval/circuit-breaker.ts` |

If a fleet feels "sloppy" — proposals appearing twice, agents undoing each
other, the same lead getting hit by two outreach agents — the answer is
almost always **lease arbitration on the right (kind, key)**. The other
three mechanisms exist for distinct failure modes.

## Designing an agent so it plays nicely

1. **Pick the smallest lease target.** Not "the tenant", not "the agent" —
   the actual resource the action mutates. `lead/L-12345`, `deal/D-9`,
   `connector_record/hubspot:contact:440`, `objective/obj-abc`.
2. **Acquire BEFORE the tool call; release on terminal.** Wrap the tool
   dispatch in `requestLease` … `releaseLease`. The runner does this for
   you when you mark a tool as `requiresLease: true`; manual leasing is
   for cross-tool sequences.
3. **Respect `conflict` decisions.** When `requestLease` returns
   `conflict`, the operator-readable rationale is right: another agent is
   working this resource. Yield (re-queue at `retryAfterMs`) or, if your
   objective allows it, pick a different target and move on.
4. **Don't propose what another agent already proposed.** When you write
   an approval, the lease on the target prevents the duplicate. Trust the
   lease — don't add your own "is there already a proposal here" check;
   you'd race against the operator deciding.
5. **Set your `objective_id` when you're working a durable target.** The
   reflexion loop carries failure context into the next attempt only
   when there IS an objective. A run with no objective is a one-shot.

## Designing a fleet so it plays nicely

1. **Domain partitioning, not overlap.** Two agents that touch the same
   resource should have NON-OVERLAPPING responsibilities on it. The
   ad-spend watcher PAUSES underperforming adsets; the creative-miner
   GENERATES new creative for them. Both touch `adset/X` — different
   verbs — and the lease (held in turn) prevents a race.
2. **Triage agents before action agents.** Triage routes; action acts.
   A `lead-router` agent labels and assigns; an `outreach-writer` then
   acts on labeled leads. They are sequenced by labeling state, not
   by leases — the action agent's trigger is the triage agent's output.
3. **One cant-fail per safety domain.** ad-claim-compliance is the only
   T-critical agent that signs off on ad copy. Adding a second cant-fail
   on the same domain would force the system to choose between them at
   runtime — that's a doctrine question, not a runtime one.
4. **Let the Architect synthesize, then HUMAN-REVIEW the team.** The
   Architect (`architect/`) won't double-spec the same function (it
   refuses CRA territory entirely, and it uses the model catalog), but
   it doesn't reason about resource leases. A human reviewing the
   blueprint should ask: "which agents touch the same (kind, key)?"
   and add explicit leases where the answer is "more than one."

## What the platform handles for you (no agent-side work)

- **Model selection** — Model Router picks the fuel; agents declare a tier.
- **Budget** — `BudgetTracker` reserve/commit/release on every dispatch.
- **Cant-fail invariant** — Opus pin, override-exempt, runtime fail-closed.
- **CRA refusal** — eligibility-decisioning categories refused upstream.
- **Injection scrub** — every tool dispatch through `tool.connector.*`
  passes through `injection-guard.ts`.
- **Tenant isolation** — RLS on every read, including the vector store.
- **Cost cap** — tenant monthly budget, per-run budget, chat-dispatch gate.

These are LOAD-BEARING gates. An agent author cannot opt out and should
not try.

## What the platform DOES NOT handle yet (manual coordination required)

- **Async A2A handoffs** (V2 P7). When agent A finishes and wants agent B
  to take over on the SAME objective, manual today (operator routes by
  changing `runs.next_agent` or the user-visible flow). Coming in P7;
  spec'd in PLATFORM-V2-ROADMAP.md.
- **Autonomous manager** (V2 P8). Spawning/pausing/retiring agents within
  budget is operator-driven today.

Document these to the fleet operator so they know where they're filling
the gap manually.

## "Don't overlap / don't create slop" checklist

Before declaring a fleet ready:

- [ ] Every action agent declares its lease target shape (no agent that
      mutates a connector record without a lease).
- [ ] Every (kind, key) namespace is documented — operators can read
      "what does `lead/X` mean to this fleet?"
- [ ] No two agents share the same lease target with the same VERB.
      (Same target with DIFFERENT verbs is fine.)
- [ ] Cant-fail agents are documented per-domain; only one per domain.
- [ ] Architect blueprint review checked the resource-target map.

## Running the launch readiness check

```bash
pnpm tsx scripts/launch-readiness/launch-readiness.ts
```

That script verifies the platform invariants. This doc covers the FLEET
invariants — the human-judgment ones a script can't check.
