---
status: issues
phase: 60-66
scope: phases 60-66 (model intelligence observability cluster)
depth: standard
files_reviewed: 4
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
---

# Code Review — Phases 60-66 (Model Intelligence Observability)

Cluster review across the seven commits that shipped the model.routed audit
trail, operator dashboard, live budget card, cost-by-model breakdown,
architect rationale surface, per-tier overrides, and per-agent MTD. The
common substrate is `apps/control-plane/src/lib/data.ts` — every page in
the cluster reads from `modelRoutingRecent` plus a few derived helpers, so
the warnings below cascade across multiple pages.

## Findings

### WR-001 — MTD undercount when `limit=500` truncates a busy tenant's month

**Severity:** Warning
**File:** `apps/control-plane/src/lib/data.ts:198-210` (`agentSpendThisMonth`); same pattern at `costByModel` `:216-229`

`agentSpendThisMonth` calls `modelRoutingRecent(tenantId, limit=500)` then
filters in memory by `monthPrefix`. The underlying query orders by
`occurred_at DESC` and slices, so for any tenant with >500 model.routed
events in recent history the *oldest* events in the current month are
silently dropped. Result: the Agents page's per-card "MTD" figure
understates spend without warning. The Cost dashboard's `costByModel` is
worse — it doesn't filter by month at all (no month-prefix guard), so the
"Spend by model" panel sums a rolling window of indeterminate length.

**Fix sketch:** Bound the query by `occurred_at >= startOfMonth` server-side
(both demo path filter + Supabase WHERE), drop the `limit` cap for the
MTD-derived helpers, and centralize "events for current month" in one
helper that both `agentSpendThisMonth` and `costByModel` consume.

### WR-002 — `monthPrefix` derived two different ways across the data layer

**Severity:** Warning
**File:** `apps/control-plane/src/lib/data.ts:146` vs `:201`

`tenantBudgetStatus` (Phase 62) computes the current month as:

```ts
const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
```

— this is **local** time. `agentSpendThisMonth` (Phase 66) computes it as:

```ts
const monthPrefix = now.toISOString().slice(0, 7);
```

— this is **UTC**. On servers (and operator browsers) outside UTC, the two
helpers will disagree at month boundaries. The Cost page's live budget bar
and the Agents page's per-agent MTD column come from the *same* underlying
event stream but use *different* definitions of "this month", so they will
drift for the first/last day of a month in any non-UTC tenant.

**Fix sketch:** Standardize on UTC (`toISOString().slice(0, 7)`) — Relay
events store `occurred_at` as `timestamptz` (UTC) so UTC matches the
storage canonically. Add a single `currentMonthPrefix()` helper at the
top of `data.ts` and use it in both call sites.

### WR-003 — `costByModel` panel is unbounded by time; label promises MTD

**Severity:** Warning
**File:** `apps/control-plane/src/lib/data.ts:216-229`; `apps/control-plane/src/routes/_app/cost.tsx` (panel header)

`costByModel` aggregates every applied event in the `modelRoutingRecent`
response. That response is `limit=500` and ordered DESC, so the panel
shows "the last ≤500 events grouped by model" — not month-to-date. The
budget card directly above it is MTD. Operators reading both panels
without scrolling to the source will conflate the two.

**Fix sketch:** Either filter `costByModel` to the current month (preferred,
matches the budget bar) or change the panel header to "Recent model spend
(last 500 events)" so the semantics are explicit. Tied to WR-001.

### INFO-001 — Brittle float equality in card-footer fallback

**Severity:** Info
**File:** `apps/control-plane/src/routes/_app/agents.tsx:158`

```tsx
{cost > 0 && cost !== mtdSpend && (
  <span ...>{formatUsd(cost)}</span>
)}
```

For agents whose lifetime cost happens to coincide with this month's cost
(single-run agents, freshly seeded agents), `cost === mtdSpend` will hide
the all-time number entirely, even though the operator might want to see
it confirmed. Use a small tolerance:

```tsx
{cost > 0 && Math.abs(cost - mtdSpend) > 0.005 && ...}
```

— or only hide the all-time figure when it's *smaller* than MTD (which
shouldn't happen in practice).

### INFO-002 — Non-string `occurredAt` events silently dropped from MTD

**Severity:** Info
**File:** `apps/control-plane/src/lib/data.ts:206`

```ts
if (typeof e.occurredAt === "string" && !e.occurredAt.startsWith(monthPrefix)) continue;
```

If `occurredAt` is ever a `Date` or `null` (defensive: PostgREST returns
ISO strings today, but the `ModelRoutingEvent` type doesn't enforce it),
the event slips through the prefix check and contributes to MTD
regardless of its actual date. The intent is "skip events not in this
month"; the code is "skip events in this month if they're strings."
Invert: assert `occurredAt` is a string in the type and skip the guard,
or normalize:

```ts
const occ = typeof e.occurredAt === "string" ? e.occurredAt : new Date(e.occurredAt).toISOString();
if (!occ.startsWith(monthPrefix)) continue;
```

## Top recommendation

WR-001 + WR-002 + WR-003 are the same root cause: month-of-spend rollups
were added page-by-page across phases 62, 63, and 66 without a shared
helper. One small refactor — `currentMonthPrefix()` + `eventsThisMonth()`
helpers in `data.ts` — collapses three warnings into one fix and
eliminates the drift before it lands in user-visible numbers.
