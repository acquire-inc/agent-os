# Agent Lease Arbitration

**Audience:** agents, runners, and humans wiring new resource types into the
arbitration layer. This doc is the agent-readable spec for how the platform
keeps two agents from acting on the same target resource at the same time.

> **Pair**: this doc + `packages/core/src/lease.ts` are the pure layer.
> Migration `supabase/migrations/0029_agent_leases.sql` is the DB-side safety
> net (unique partial index on active leases). Tests:
> `packages/core/src/lease.test.ts` (offline, 42 assertions).

## Why this exists

Without arbitration, two agents triggered against the same lead, deal,
connector record, objective, or tool invocation can:

- write contradictory updates
- propose conflicting actions to the human inbox
- double-charge budget (each one reserves cost against the same target)
- emit duplicate `model.routed` events that mislead the cost dashboard

That's the operator-visible "slop / interfere" failure mode. Leases are
the simplest fix: a target is held by one run; everyone else gets a clear
decision instead of racing.

## Target shape

A lease target is `(kind, key)` — both strings. Any future resource type
joins the arbitration layer by picking a stable key; no schema change
needed.

```
lead/L-12345
deal/D-9
objective/abc
tool.connector.slack/channel-9
mcp.hubspot/contact-440
```

## Decision matrix

`decideLease(request, active, nowIso)` returns one of four decisions:

| Active state                                  | Request | Decision |
|-----------------------------------------------|---------|----------|
| no active lease, or expired, or released      | any     | **grant** |
| held by the same `ownerRunId` (self)          | any     | **renew** (self-extend) |
| held by another run, requester is cant-fail, holder is NOT | cant-fail | **preempt** (tier wins) |
| any other "held by another run"               | any     | **conflict** (back off + retry) |

### Doctrine rules (encoded, not defaults)

1. **Cant-fail never yields to non-cant-fail.** A T-critical agent's
   request preempts a non-cant-fail lease holder. The held *run* keeps
   executing — preempt only frees the *lease*. (If you want to kill the
   run too, that's a separate operator-level action.)
2. **Cant-fail vs cant-fail never preempts.** Equals don't fight; the
   second cant-fail yields and queues.
3. **Cant-fail TTL floor is 5 minutes.** Short-TTL games can't be used
   to kick a critical run.
4. **Self-renewals always grant.** A renewing run can't be preempted by
   itself.
5. **Every decision emits to the relay.** Operators see the full audit
   trail in `agent.lease_decided`; cant-fail preempts also emit
   `cantfail.lease_preempt` for the safety-tier dashboard.

## How a runner uses this

Before dispatching a tool that targets a sequencable resource:

```ts
import { requestLease, releaseLease, formatLeaseTarget } from "@agent-os/core";

const { decision, lease } = await requestLease(
  {
    target: { kind: "lead", key: leadId },
    requestedBy: { ownerAgentId, ownerRunId, ownerIsCantFail },
    ttlMs: 5 * 60 * 1000, // 5 minutes — clamped per doctrine
  },
  leaseSink, // built by lifecycle.ts at runner boot
);

if (decision.kind === "conflict") {
  // Yield to the existing holder. Back off and re-request, or escalate to
  // an objective-level reflexion (P3) so the next attempt sees the prior
  // collision in its bundle.
  await sleep(decision.retryAfterMs ?? 15_000);
  return /* retry */;
}

// decision.kind is grant | renew | preempt — proceed.
try {
  await dispatchTheTool();
} finally {
  if (lease) await releaseLease(lease.id, leaseSink);
}
```

On terminal run finish, the lifecycle's terminal hook should release any
outstanding leases held by the run (DB-side, set `released_at = now()`
where `owner_run_id = $runId`). The TTL is a safety net for crashed
runners; the explicit release is the happy path.

## What kinds need a lease?

Default policy is **opt-in**, not opt-out. Adding leases everywhere would
serialize work that doesn't actually conflict. Use a lease when:

- the action writes to a connector record (Slack message edit, HubSpot
  field update, Stripe refund) and a duplicate write would be visible to
  end users or auditors,
- the action moves money (budget reserve / refund / payout),
- multiple agents on the same tenant could plausibly be dispatched on
  the same target in the same minute (the bigger the fleet, the more
  often this happens),
- the agent emits proposals to the human inbox — leases prevent the
  "three open proposals on the same lead" UI mess.

Don't lease read-only tools, retrieval, summarization that produces a
new artifact, or runs whose targets are intrinsically unique (a new
`runs.id`, a new artifact id).

## Operator visibility

The control plane sees lease decisions on the relay stream. UI surface
to add (TODO when DB is live):

- Fleet Activity timeline row "agent X held off by agent Y on `lead/L-1`"
- Per-agent metric "conflicts this hour"
- Cant-fail safety-tier dashboard row when `cantfail.lease_preempt` fires

## Running the test suite

```bash
pnpm --filter @agent-os/core test:lease           # offline, 42/42
DATABASE_URL=… # live arbitration test — adds in the next launch pass
```

## How to extend safely

1. New decision rule: add the branch in `decideLease`, the test in
   `lease.test.ts`, the doctrine row in the matrix above.
2. New target kind: pick a stable `kind` string (see naming above), wire
   the runner to call `requestLease` at dispatch, release at terminal.
   No code change in `lease.ts` needed.
3. New relay variant: add the event name in `relay/events.ts`, the
   emit branch in `lease.ts` runner, the dashboard subscription.

## Compliance notes

- Lease arbitration does NOT change autonomy, can't-fail, CRA, model
  routing, or budget enforcement. It only sequences work.
- Cant-fail preempts are recorded in the audit trail (separate event)
  so an operator can review every safety-tier intervention.
- Tenant scoping: target keys are per-tenant; one tenant's `lead/L-1`
  is unrelated to another's. RLS on `agent_leases` enforces this.
