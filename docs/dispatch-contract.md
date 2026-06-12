# Dispatch / Results Contract

**Audience:** agents and humans extending the runner, lifecycle, or bundle code.
This doc is the agent-readable spec for the platform's most load-bearing seam.
If an agent can't add a feature here using only this doc + the linked tests,
the doc is incomplete — open a PR to fix it.

> **Pair**: this doc + `packages/core/src/dispatch-contract.ts` are the offline
> contract twin (idea I-002). `packages/core/src/integration.test.ts` is the
> live twin and runs only with `DATABASE_URL` set. The offline twin catches
> application-side drift on every push; the live twin catches DB-side drift
> at operator gates.

## What this contract covers

The lifecycle of one `runs` row from scheduling through termination, and
the on-the-wire shape the runner needs to do its job:

1. **Status partitions** — every `RunStatus` belongs to exactly one of:
   `terminal | in-flight | waiting | claimable`.
2. **State machine** — which `(from, to)` status transitions are valid.
3. **Claim ordering** — how `claimNextRun` must choose among ready rows.
4. **Bundle shape** — the structural contract `buildBundle` promises the runner.
5. **Approval cycle** — the canonical sequence `running → waiting → pending → running`.
6. **Session-end invariant** — exactly one `session_end` event per terminal transition.
7. **Tools registry** — deny-by-default + unique `(tenant_id, key)`.

What it does NOT cover (deliberate — these need a live DB):

- RLS isolation across tenants → `packages/tool-rls-test` + `scripts/verify/isolation-live.ts`.
- Atomicity of `claimNextRun` (no double-claim under race) → live integration test.
- Vector retrieval correctness → `memory.test.ts` (pure) + live integration.

## Status partitions

```ts
import {
  RUN_TERMINAL_STATUSES,   // ["done", "failed", "skipped"]
  RUN_IN_FLIGHT_STATUSES,  // ["running"]
  RUN_WAITING_STATUSES,    // ["waiting"]
  RUN_CLAIMABLE_STATUSES,  // ["pending", "scheduled"]
} from "@agent-os/core";
```

Compile-time exhaustiveness check: if you add a status to
`packages/shared/src/enums.ts`, the partition union must explicitly include
it or `tsc` errors. **Don't suppress; classify.**

Quick predicates: `isTerminalStatus`, `isClaimableStatus`, `isWaitingStatus`,
`isInFlightStatus`.

## State machine

| from        | allowed `to`                                | notes |
|-------------|----------------------------------------------|-------|
| `scheduled` | `running`, `skipped`                         | gate refusal / paused agent may skip without ever running |
| `running`   | `done`, `failed`, `skipped`, `waiting`       | terminal three + propose-gate park |
| `waiting`   | `pending`, `skipped`                         | operator decides → resume; or dismisses |
| `pending`   | `running`                                    | resume claim |
| `done`/`failed`/`skipped` | — (terminal)                   | no further transitions; downstream writes fire on entry |

Self-transitions (`s → s`) are always refused — the lifecycle never
re-stamps. Use `validRunTransition(from, to)` from `dispatch-contract.ts`
when adding new lifecycle writes.

## Claim ordering

`claimNextRun` must:

1. Filter to `RUN_CLAIMABLE_STATUSES` (`pending`, `scheduled`).
2. Prefer `pending` (a resumed run) over `scheduled` (fresh work). Resumed
   work must not starve behind fresh dispatches.
3. Within a priority bucket, oldest `scheduledFor` first (FIFO; `null` = epoch 0).

`orderClaimQueue<T>(candidates)` is the canonical pure implementation. If a
runtime sort lands that disagrees with this function, the contract test fails.

## Bundle shape

`buildBundle(db, runId, baseUrl, opts?)` returns `Bundle | null`. The
structural fields a runner consumes:

```ts
{
  run:    { id, status, triggerSource, scheduledFor, sdkSessionId }
  job:    { name, instructions, scheduleCron } | null
  agent:  { id, tenantId, key, name, persona, backend, model, thinkingLevel,
            autonomy, escalationPolicy, budgetCapUsd, runnerKind }
  docs:           []
  skills:         []  // includes preferredModelTier, taskProfile, costEstimateUsd
  mcpServers:     []
  tools:          []  // includes requiresApproval, costEstimateUsd, preferredModelTier
  knowledge:      []  // injected by KnowledgeRetriever (optional)
  priorLearnings: []  // injected from agent-scoped memory (P2)
  envVars:        {}
  autonomy:       string
  escalationPolicy: string | null
  budgetCapUsd:   number | null
  knowledgeScope: { folders, tags }
  api: {
    statusUrl,                  // must start with baseUrl
    activityUrl,
    approvalsUrl,
    validStatuses,              // must equal RUN_STATUSES as a set
  }
}
```

Validate any change with `validateBundleShape(bundle, baseUrl)`. The
`api.validStatuses` SET match against `RUN_STATUSES` is the canary that
catches status-rename drift.

## Approval cycle

When a run hits a propose gate, the platform promises:

```
running → waiting → pending → running
```

Anything else is contract drift. Validate with `validateApprovalCycle(statuses)`
passing the recorded status history of one run.

Endpoint pair:

- `raiseApproval(db, …)` — flips run to `waiting`, inserts approval row.
- `resolveApproval(db, approvalId, choiceKey, decidedBy)` — flips run to
  `pending`; the runner re-claims it back to `running`.

## Session-end invariant

`setRunStatus(db, runId, { status: terminal, … })` must produce **exactly one**
`session_end` autonomy event whose `rationale` matches the terminal status.

Validate with `validateSessionEndInvariant(events, terminalRunsByRunId)`.
The check enforces:

1. exactly one `session_end` per terminal run,
2. its `rationale` equals the terminal status,
3. no `session_end` for a non-terminal run.

## Tools registry

`tools` rows promise:

- `requires_approval` defaults to `true` (deny-by-default).
- `(tenant_id, key)` is unique.
- Cross-tenant reads return zero rows (RLS — verified live).

Validate offline with `validateToolsRegistry(rows)`.

## How to extend safely

1. Read this doc + the test file `packages/core/src/dispatch-contract.test.ts`.
2. Add the new behavior. Run `pnpm --filter @agent-os/core test:dispatch-contract`.
3. If you added a new run status, extend the partition the right slot,
   add transitions, update the table above.
4. If you added a new bundle field that the runner consumes, extend
   `validateBundleShape` so future drift is caught here.
5. Open the PR. The standing OS-RALPH gate `contract` will execute this
   suite on every run.

## Running the contract suite

```bash
# Offline (always — CI, sandbox, dev):
pnpm --filter @agent-os/core test:dispatch-contract

# Live (operator-gated):
DATABASE_URL=postgres://… pnpm --filter @agent-os/core test
```
