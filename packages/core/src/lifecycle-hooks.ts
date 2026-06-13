// Lifecycle hook signatures — the seam where the V2 pure-logic modules attach
// to the runtime once the operator brings up the live DB.
//
// Today (cloud session, no DB): the pure modules ship + their offline tests
// run + the relay events are registered + the migrations are authored. The
// runtime call sites are deliberately STUBS — they import these interfaces
// and call them through a no-op default sink. After `supabase db push`, the
// operator wires the real DB-bound sinks (Drizzle queries) and the loops go
// live.
//
// This file is the contract between lifecycle.ts (DB-bound) and the V2
// modules (pure). It exists so an agent or human can see the entire
// integration surface in one place without grepping the whole codebase.
//
// Hooks (called from lifecycle.ts on every runs lifecycle transition):
//
//   onRunFinish(runId, terminalStatus)
//     1. writeRunMemory          — packages/core/src/memory.ts (P1/P2)
//                                   composes the episode + lessons, writes to
//                                   the agent-scoped vector namespace.
//     2. runReflexion            — packages/core/src/objective.ts (P3)
//                                   if run carries objective_id, decide
//                                   retry/complete/abandon + queue follow-up.
//     3. evaluateCircuitBreaker  — packages/core/src/eval/circuit-breaker.ts (P5)
//                                   look at last few runs; pull autonomy down
//                                   or pause on streak/cant-fail event.
//     4. releaseLeases           — packages/core/src/lease.ts (I-003)
//                                   release every lease held by this run so
//                                   the next agent isn't blocked by a crashed
//                                   runner's stale lease.
//
//   onScorecardCycle(agentId)  — runs on the ~6h Inngest cadence:
//     5. runScorecardJob         — packages/core/src/eval/job.ts (existing)
//                                   the durable autonomy verdict.
//     6. runSelfImprovement      — packages/core/src/improve.ts (P4)
//                                   look at recurring lessons; propose a
//                                   prompt amendment when patterns recur.
//
//   onApprovalVoteRecorded(approvalId)  — when a critic agent votes:
//     7. runCriticReview         — packages/core/src/critic.ts (P6)
//                                   tally votes; auto-approve on quorum, or
//                                   escalate to human on rejection.
//
//   onPreToolUse(toolName, target?)  — runner PreToolUse hook (already exists):
//     8. requestLease            — packages/core/src/lease.ts (I-003)
//                                   sequence the tool dispatch against the
//                                   target resource. Conflict → yield/retry.
//
// SAFETY (re-stated; encoded in each module):
//   - Can't-fail agents never auto-apply improvements.
//   - Can't-fail proposers never enter critic review.
//   - Can't-fail leases never auto-expire below 5-minute floor.
//   - Reflexion never exceeds objective.max_attempts.
//   - Circuit-breaker NEVER ratchets autonomy up; only down or pause.

import type { CircuitBreakerSink } from "./eval/circuit-breaker.js";
import type { ImprovementSink } from "./improve.js";
import type { LeaseSink } from "./lease.js";
import type { ReflexionSink } from "./objective.js";
import type { CriticReviewSink } from "./critic.js";

/** All the sinks lifecycle.ts must construct on boot. Pass a `db` + a relay
 *  emitter to a single `buildLifecycleSinks(db, emit)` factory and route the
 *  individual sinks below into their respective runners. */
export interface LifecycleSinks {
  /** P1+P2: writes the agent-scoped episode + lessons on every terminal
   *  finish. Implementation lives in lifecycle.ts writeRunMemory(); this
   *  type pins its eventual call signature so it can be passed around. */
  writeRunMemory: (input: {
    runId: string;
    tenantId: string;
    agentId: string;
    agentKey: string;
    terminalStatus: "done" | "failed" | "skipped";
    summary: string;
    costUsd?: number | null;
    budgetCapUsd?: number | null;
    verificationPassed?: boolean | null;
    approvalOutcome?: "approved" | "rejected" | "none";
  }) => Promise<void>;

  /** P3 sink: load objective + attempts; decide retry/complete/abandon. */
  reflexion: ReflexionSink;

  /** P4 sink: load recurring lessons + current prompt; propose amendment. */
  improvement: ImprovementSink;

  /** P5 sink: load recent samples; demote/pause on streak. */
  circuitBreaker: CircuitBreakerSink;

  /** P6 sink: load proposal + votes; quorum approve or escalate. */
  criticReview: CriticReviewSink;

  /** I-003 sink: lease acquire/release/renew/emit for the runner. */
  lease: LeaseSink;
}

/** The (call-this-from-lifecycle.ts) entry-point signatures. Once the live DB
 *  is up, lifecycle.ts builds `sinks` once and calls these from the right
 *  transition points. */
export interface LifecycleEntryPoints {
  /** Called from setRunStatus when a run reaches a terminal status. Fans out
   *  to memory write-back, reflexion (if objective_id), circuit-breaker,
   *  lease release. Order matters: memory before reflexion (so the next
   *  attempt sees the lesson) before circuit-breaker (so the breaker's
   *  recent-runs window includes the just-finished run). Lease release runs
   *  last and never throws (best-effort). */
  onRunFinish: (input: {
    runId: string;
    tenantId: string;
    agentId: string;
    terminalStatus: "done" | "failed" | "skipped";
  }) => Promise<void>;

  /** Called by the Inngest scorecard-cadence schedule. Fans out to the
   *  scorecard job (durable autonomy verdict) and the self-improvement
   *  proposer. Cant-fail filtering happens INSIDE each module. */
  onScorecardCycle: (input: { agentId: string; tenantId: string }) => Promise<void>;

  /** Called when a critic agent records a vote on an approval. Tallies and
   *  either auto-approves (quorum) or escalates (any rejection). */
  onApprovalVoteRecorded: (input: { approvalId: string }) => Promise<void>;

  /** Called from the runner's PreToolUse hook for tools whose dispatch
   *  targets a sequenceable resource. The runner's return is the lease
   *  decision; the runner decides whether to proceed, yield, or retry. */
  onPreToolUse: (input: {
    runId: string;
    agentId: string;
    isCantFail: boolean;
    targetKind: string;
    targetKey: string;
    ttlMs?: number;
  }) => Promise<{ proceed: boolean; retryAfterMs: number | null; rationale: string }>;
}
