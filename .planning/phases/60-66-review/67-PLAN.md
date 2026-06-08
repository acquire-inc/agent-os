---
phase: 67
plan_id: 67-month-rollup-consolidation
wave: 1
depends_on: []
files_modified:
  - apps/control-plane/src/lib/data.ts
  - apps/control-plane/src/routes/_app/agents.tsx
  - apps/control-plane/src/routes/_app/cost.tsx
autonomous: true
requirements: [WR-001, WR-002, WR-003, INFO-001, INFO-002]
source_review: .planning/phases/60-66-review/60-66-REVIEW.md
---

# Phase 67: Month-Rollup Consolidation (data.ts hygiene)

## Objective

Collapse the three duplicate month-rollup code paths added across phases 62,
63, and 66 into a single shared helper. Fix the local-vs-UTC drift, lift the
silent `limit=500` MTD undercount, and label the "spend by model" panel
honestly. Operator-visible numbers should agree across the Cost dashboard
and the Agents page.

## must_haves

- `tenantBudgetStatus`, `agentSpendThisMonth`, and `costByModel` all derive
  "current month" through one helper — no `getFullYear()/getMonth()` or
  `toISOString().slice(0, 7)` literals outside that helper.
- `agentSpendThisMonth` no longer silently caps at 500 events when the
  tenant has more than 500 model.routed events this month. Either it
  fetches enough to cover the month, or it ships a documented warning
  surfaced to the operator.
- `costByModel` either filters to current month (matching the budget bar)
  or its panel header explicitly says "last N events" — no ambiguous
  labelling.
- Agents page's MTD column and Cost page's budget bar agree to the cent
  on `now` (verified by a same-tenant cross-check).

## truths

- T-001: Relay events store `occurred_at` as `timestamptz` (UTC). Any
  client-side month derivation MUST be UTC to match storage.
- T-002: `modelRoutingRecent` is shared by 3 consumers (dashboard, agents,
  cost-by-model). A change to its semantics ripples to all 3.
- T-003: `cost_usd` is a number on the payload — float comparison is
  unsafe; use a tolerance or use ">=" semantics.

## Tasks

### Task 1 — Extract `currentMonthPrefixUtc()` helper

<read_first>
- apps/control-plane/src/lib/data.ts
</read_first>

<action>
Add a module-private helper at the top of `apps/control-plane/src/lib/data.ts`:

`function currentMonthPrefixUtc(): string` — returns `new Date().toISOString().slice(0, 7)`.

Replace the literal at `data.ts:146` (`tenantBudgetStatus`) — currently uses local-time `${now.getFullYear()}-${pad(now.getMonth()+1)}` — with a call to the new helper.

Replace the literal at `data.ts:201` (`agentSpendThisMonth`) — currently uses `toISOString().slice(0, 7)` inline — with the helper.

No other behavioral change in this task.
</action>

<acceptance_criteria>
- `grep -n "getFullYear\|getMonth\|toISOString().slice(0, 7)" apps/control-plane/src/lib/data.ts` returns exactly one match: the helper definition.
- `tenantBudgetStatus` calls `currentMonthPrefixUtc()`.
- `agentSpendThisMonth` calls `currentMonthPrefixUtc()`.
- `pnpm --filter control-plane typecheck` exits 0.
</acceptance_criteria>

### Task 2 — Lift the `limit=500` MTD cap

<read_first>
- apps/control-plane/src/lib/data.ts
</read_first>

<action>
In `agentSpendThisMonth`, stop calling `modelRoutingRecent(tenantId, 500)` and instead query the full set of applied=true model.routed events for the current month.

For the Supabase path (in `modelRoutingRecent` body — `apps/control-plane/src/lib/data.ts:178-191`): add a sibling helper `modelRoutingForMonth(tenantId, monthPrefix)` that filters server-side with `.gte("occurred_at", `${monthPrefix}-01`).lt("occurred_at", nextMonth)`. No limit clause.

For the demo path: filter `demoModelRoutingEvents` to events whose `occurredAt.startsWith(monthPrefix)`.

`agentSpendThisMonth` calls `modelRoutingForMonth` instead of `modelRoutingRecent` and removes its own in-memory month-prefix filter (now redundant).
</action>

<acceptance_criteria>
- `apps/control-plane/src/lib/data.ts` defines `modelRoutingForMonth(tenantId: string, monthPrefix: string)` returning `Promise<ModelRoutingEvent[]>`.
- `agentSpendThisMonth` body no longer references `limit` or `modelRoutingRecent`.
- Supabase branch of `modelRoutingForMonth` uses `.gte("occurred_at", ...)` and `.lt("occurred_at", ...)` — verified by grep.
- `pnpm --filter control-plane typecheck` exits 0.
</acceptance_criteria>

### Task 3 — Make `costByModel` honest about its time window

<read_first>
- apps/control-plane/src/lib/data.ts
- apps/control-plane/src/routes/_app/cost.tsx
</read_first>

<action>
Decision: filter `costByModel` to the current month (matches the budget bar directly above it on the Cost dashboard, which is MTD).

In `apps/control-plane/src/lib/data.ts:216-229`, change `costByModel` to call the new `modelRoutingForMonth(tenantId, currentMonthPrefixUtc())` instead of `modelRoutingRecent(tenantId, 500)`. Drop the `limit` parameter from the public signature.

In `apps/control-plane/src/routes/_app/cost.tsx`, locate the `ModelSpendCard` (panel header presently labelled something like "Spend by model"). Update the panel header to "Spend by model (this month)" so the time window is explicit.
</action>

<acceptance_criteria>
- `costByModel(tenantId: string): Promise<...>` — no `limit` parameter remaining.
- `costByModel` body contains no `limit` references.
- `apps/control-plane/src/routes/_app/cost.tsx` panel header text matches "Spend by model (this month)" (or an equivalent month-bounded label).
- `pnpm --filter control-plane typecheck` exits 0.
</acceptance_criteria>

### Task 4 — Float-safe equality on Agents card

<read_first>
- apps/control-plane/src/routes/_app/agents.tsx
</read_first>

<action>
In `apps/control-plane/src/routes/_app/agents.tsx` around line 158, replace the brittle `cost > 0 && cost !== mtdSpend` guard with a tolerance-based comparison.

Change to: `cost > 0 && Math.abs(cost - mtdSpend) > 0.005` — i.e., hide the all-time figure only when it agrees with MTD to half a cent.
</action>

<acceptance_criteria>
- Grep for `cost !== mtdSpend` in `apps/control-plane/src/routes/_app/agents.tsx` returns no matches.
- Grep for `Math.abs(cost - mtdSpend) > 0.005` returns exactly one match.
- `pnpm --filter control-plane typecheck` exits 0.
</acceptance_criteria>

### Task 5 — Type the `occurredAt` field as a string and drop the runtime guard

<read_first>
- packages/shared/src/types.ts
- apps/control-plane/src/lib/data.ts
</read_first>

<action>
Confirm in `packages/shared/src/types.ts` that `ModelRoutingEvent.occurredAt` is typed as `string`. If it is typed as `string | Date` or `unknown`, narrow it to `string` (PostgREST always returns ISO strings).

In `apps/control-plane/src/lib/data.ts:206`, remove the `typeof e.occurredAt === "string"` guard. The month-prefix filter is now applied server-side by `modelRoutingForMonth` (Task 2) so this guard is redundant at the call site as well.
</action>

<acceptance_criteria>
- `packages/shared/src/types.ts` declares `occurredAt: string` for `ModelRoutingEvent` (no union with Date or unknown).
- `apps/control-plane/src/lib/data.ts` no longer contains `typeof e.occurredAt`.
- `pnpm --filter control-plane typecheck` exits 0.
- `pnpm --filter @agent-os/shared typecheck` exits 0.
</acceptance_criteria>

## Verification

```bash
pnpm --filter control-plane typecheck
pnpm --filter control-plane build
pnpm --filter @agent-os/shared typecheck
git diff --stat
```

Expected diff stat: ~3 source files changed, < 100 lines net delta (mostly
re-routing through the new helper).

## Risk

Low. Pure consolidation — no new public API, no schema change, no behavior
visible to operators except the cost-by-model panel now bounded to the
current month (which is more accurate, not less).
