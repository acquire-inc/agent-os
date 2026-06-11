// relay/events.ts — the CLOSED canonical event-name namespace.
//
// Schema is in supabase/migrations/0011_relay_events.sql but enforcement of
// the closed set lives HERE in code (see migration comment for rationale).
// emit() rejects unknown names BEFORE the DB insert; v2 D3.1's
// `event-schema-guardian` agent audits drift between this registry and what's
// landed in the relay_events table.
//
// New event names go through code review here. Adding to this list is a
// schema decision (downstream consumers — run_summaries composer, Pixel SDK,
// xtenant aggregation view — all read from the names listed below).
//
// Canonical contract: docs/plans/AGENT-OS-PLAN.md §8.3.

export const EVENT_NAMES = [
  // Run lifecycle (carrier: runner @ claim and @ SessionEnd)
  "run.started",
  "run.completed",
  "run.failed",
  "run.escalated",

  // Tool dispatch + result (carrier: PreToolUse, PostToolUse hooks)
  "tool.dispatched",
  "tool.result",

  // Approval routing (carrier: PreToolUse hook + approval endpoint)
  "approval.requested",
  "approval.resolved",

  // Autonomy gate decisions (carrier: autonomy gate inside PreToolUse)
  "autonomy.escalated",
  "autonomy.allowed",
  "autonomy.denied",

  // Budget cap (carrier: cost.checkBudget + Stop hook)
  "budget.warn",
  "budget.cap_hit",
  // Budget reserve/commit/release pattern (Phase 16) — per the
  // cost-ceiling-discipline skill. Reserves are tracked per-run;
  // every spend goes through reserve -> commit (success) or release
  // (failure). cap_breached fires when a reserve would push the run
  // past budgetCapUsd; summary fires once at run close.
  "budget.reserved",
  "budget.committed",
  "budget.released",
  "budget.cap_breached",
  "budget.summary",
  // Phase 53: tenant-level monthly cap breach. Emitted by the chat
  // dispatch endpoint and the runner SessionStart guard when a tenant's
  // month-to-date spend + forecast would exceed tenants.monthly_budget_usd.
  "budget.tenant_cap_breached",

  // Findings (carrier: D5.3 agents @ recordFinding)
  "finding.recorded",

  // Credentials (carrier: tool.vault-rotate + secrets-rotation agent)
  "cred.rotated",
  "cred.expiring",

  // Agent lifecycle (carrier: lifecycle endpoint — Phase 8.5)
  "lifecycle.changed",

  // Real-time anomaly circuit-breaker (V2 P5). Emitted when recent runs trip the
  // breaker (N consecutive failures or a cant-fail event in the window) and the
  // agent is pulled to propose or paused — minutes, not the 6h scorecard cycle.
  // The dashboard consumes this as an early-warning; the scorecard job still
  // confirms the durable demote verdict.
  "anomaly.circuit_tripped",

  // Connector health (carrier: connector-health-monitor agent)
  "connector.health.degraded",
  "connector.health.recovered",

  // Knowledge (carrier: bundle build + lifecycle.ts writer)
  "knowledge.retrieved",
  "knowledge.written",

  // Architect (carrier: architect endpoint + seed step)
  "architect.proposed",
  "architect.seeded",
  // architect.refused — per GENX-PLAN.md Open Q #8 (RESOLVED mechanism).
  // Emitted by hydrate.ts assertNotCraProhibited() before the architect
  // ever returns a blueprint when a CRA-prohibited category is matched.
  // Lands when the CRA blocklist is implemented; namespace reserved now.
  "architect.refused",

  // Can't-fail safety events (carrier: runner @ SessionStart pre-dispatch)
  // Per AGENT-OS-PLAN.md Open Q #1 (RESOLVED): a T-critical agent was about
  // to dispatch on a non-Opus model. Run fails closed; no dispatch.
  "cantfail.model_violation",
  // Per GENX-PLAN.md Open Q #8 (RESOLVED): a manually-authored agent that
  // bypassed the architect refusal step trips the CRA blocklist at runtime.
  // Belt-and-suspenders for architect.refused.
  "cantfail.cra_violation",

  // Relay-internal invariant violation. Emitted when composeRunSummary
  // discovers that the just-written run_summaries.cost_actual_usd does NOT
  // match the runs.cost_usd it should mirror. The summary write is rolled
  // back (the tx throws); this event is emitted to a fresh connection so
  // ops sees the violation even though the rolled-back write left no
  // forensic trace in run_summaries. Per the Wave C guardrail: a cost
  // invariant that can fail quietly is worse than no invariant.
  "relay.invariant_violation",

  // Model Router (Step 2.5) — emitted at seed time when the router resolves
  // an agent's tier+overrides into a concrete model slug. Payload:
  // { agent_key, tier, resolved_model, reason }. Per-agent audit trail of
  // every routing decision; the run_summaries downstream view + the
  // cross-tenant aggregation can answer "what fuel did this agent class
  // run on this month" without joining the agents row.
  "model.routed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const EVENT_NAME_SET = new Set<string>(EVENT_NAMES);

export function isEventName(name: string): name is EventName {
  return EVENT_NAME_SET.has(name);
}
