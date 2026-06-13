# Autonomous Manager (V2 P8)

**Audience:** the operator running the platform, anyone designing the
scorecard / lifecycle wiring.

> Pair: this doc + `packages/core/src/manager.ts` + `manager.test.ts` (25
> assertions, offline). Migration `supabase/migrations/0031_manager_proposals.sql`.

## What this is

`decideManagerAction` runs on a schedule (Inngest cadence) over every
tenant's fleet and proposes pause/retire actions when an agent crosses a
threshold. **Every action is a PROPOSAL** — operator reviews via the
`manager_proposals` queue before any `agents.enabled = false` flip
actually lands. Same review pattern as `agent_improvement_proposals` and
`model_feedback_proposals`.

## When the manager acts

| Trigger | Action |
|---|---|
| Trailing 24h success rate < 50% | propose **pause** |
| Single agent consuming > 40% of tenant monthly budget | propose **pause** |
| Paused ≥ 14 days AND no success in ≥ 30 days | propose **retire** |

Cant-fail agents are NEVER proposed for action — operator only.

## Per-cycle cap

The manager proposes at most **3 actions per tenant per cycle** (default).
Prevents a metric blip from shutting down the fleet. Pause is prioritized
over retire when the cap is binding (active threats > stale state).

## Tuning

Override the policy at the call site:

```ts
import { runManagerCycle, DEFAULT_MANAGER_POLICY } from "@agent-os/core";

await runManagerCycle(tenantId, sink, {
  ...DEFAULT_MANAGER_POLICY,
  maxActionsPerCycle: 5,
  pauseSuccessRateFloor: 0.6, // stricter
});
```

Or wire a per-tenant policy override later (similar shape to
`scorecardThresholds`).

## What the manager NEVER does

- Spawn new agents — that lands via doctrine seeds (operator) or the
  Architect (operator-reviewed blueprint).
- Pause / retire cant-fail agents — operator-only on those 14.
- Change autonomy (the scorecard ladder + circuit-breaker already
  handle ratcheting).
- Edit budget caps (operator only).

## Operator visibility

- Fleet Activity → `manager.action_proposed` events
- Proposals queue → `manager_proposals` table (same review UI shape as
  `agent_improvement_proposals`)
- Apply/reject decisions written back as `status='applied'` / `'rejected'`

## Wiring

```ts
// In the Inngest manager-cycle function (runs daily, say):
for (const tenant of allActiveTenants) {
  await runManagerCycle(tenant.id, managerSink, policy);
}
```

The sink loads fleet samples (success rate from `runs` + spend share from
`run_summaries`/cost ledger), writes proposals, and emits the relay event.
Caller is responsible for actually applying approved proposals (a separate
endpoint sets `agents.enabled = false` and stamps `manager_proposals.status`).

## Testing

```bash
pnpm --filter @agent-os/core test:manager   # 25/25 offline
```

Live integration test against a real fleet sample is the operator's once
`supabase db push 0031` lands.
