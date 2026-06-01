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

  // Findings (carrier: D5.3 agents @ recordFinding)
  "finding.recorded",

  // Credentials (carrier: tool.vault-rotate + secrets-rotation agent)
  "cred.rotated",
  "cred.expiring",

  // Agent lifecycle (carrier: lifecycle endpoint — Phase 8.5)
  "lifecycle.changed",

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
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

const EVENT_NAME_SET = new Set<string>(EVENT_NAMES);

export function isEventName(name: string): name is EventName {
  return EVENT_NAME_SET.has(name);
}
