// Dispatch/Results Contract — offline twin (I-002).
//
// The platform's most load-bearing seam is the dispatch/results contract:
// scheduler materializes a run → runner claims it → bundle is built → tools
// dispatch / approvals raise → run terminates / resumes → memory writes back.
// Every tenant depends on this surface; contract DRIFT (a renamed status, a
// missing terminal stamp, a bundle field gone null, an approval transition out
// of order) breaks every tenant simultaneously.
//
// The live integration test (./integration.test.ts) verifies the contract
// against a real Postgres — but it requires DATABASE_URL, so CI and sandbox
// runs SKIP IT. This module is the offline twin: pure typed invariants and a
// state machine that catch application-side drift on every push, mirroring how
// objective.ts / improve.ts / critic.ts / eval/circuit-breaker.ts isolate
// their DB-bound seams behind a sink.
//
// What this module owns:
//   1. The canonical run lifecycle state machine (validRunTransition).
//   2. Status partitions: terminal / resumable / waiting-on-human / in-flight.
//   3. Bundle shape validator (structural, no Zod dep — core stays light).
//   4. Approval transition invariant (running → waiting → pending → running).
//   5. Session-end invariant (exactly one per terminal transition).
//   6. Tools-registry invariants (deny-by-default, unique key per tenant).
//
// What this module deliberately DOES NOT own:
//   - DB-side guarantees (RLS, constraints, atomicity) — those need a live DB
//     and stay verified by integration.test.ts and the live isolation suite.
//   - Vector retrieval correctness — covered by memory.test.ts.
//   - The dispatch FUNCTIONS' implementations — this module pins their CONTRACT.
//     A drift in lifecycle.ts that violates these invariants makes this test
//     fail; a drift in their DB queries is the live test's job.

import { RUN_STATUSES, type RunStatus } from "@agent-os/shared";

// --- Status partitions ------------------------------------------------------
//
// All five partitions union back to RUN_STATUSES. If a new status is added in
// shared/enums.ts, the type-narrowed sets below need a deliberate decision
// about which partition it belongs in — drift surfaces at typecheck (the
// `assertExhaustive` at the bottom of this section).

/** Run is finished — no further state changes, downstream writes (memory,
 *  scorecard, costs) fire on entry. The runner emits exactly one session_end
 *  event when a run enters one of these. */
export const RUN_TERMINAL_STATUSES = ["done", "failed", "skipped"] as const;
export type RunTerminalStatus = (typeof RUN_TERMINAL_STATUSES)[number];

/** Run is currently executing — the runner holds it and writes activity. */
export const RUN_IN_FLIGHT_STATUSES = ["running"] as const;
export type RunInFlightStatus = (typeof RUN_IN_FLIGHT_STATUSES)[number];

/** Run is parked on a human decision — only an approval resolution moves it. */
export const RUN_WAITING_STATUSES = ["waiting"] as const;
export type RunWaitingStatus = (typeof RUN_WAITING_STATUSES)[number];

/** Run is ready to be picked up by a runner. `pending` is the resume path
 *  (came back from a waiting approval); `scheduled` is the fresh path. Claim
 *  ordering is `pending` BEFORE `scheduled` so resumed work doesn't starve. */
export const RUN_CLAIMABLE_STATUSES = ["pending", "scheduled"] as const;
export type RunClaimableStatus = (typeof RUN_CLAIMABLE_STATUSES)[number];

/** Compile-time guard: every RunStatus belongs to exactly one partition.
 *  If a new status is added to RUN_STATUSES without updating the partitions
 *  above, this type errors at typecheck. */
type _AllPartitions = RunTerminalStatus | RunInFlightStatus | RunWaitingStatus | RunClaimableStatus;
type _Exhaustive = Exclude<RunStatus, _AllPartitions> extends never
  ? Exclude<_AllPartitions, RunStatus> extends never
    ? true
    : never
  : never;
const _exhaustiveAssertion: _Exhaustive = true;
void _exhaustiveAssertion;

export function isTerminalStatus(s: string): s is RunTerminalStatus {
  return (RUN_TERMINAL_STATUSES as readonly string[]).includes(s);
}
export function isClaimableStatus(s: string): s is RunClaimableStatus {
  return (RUN_CLAIMABLE_STATUSES as readonly string[]).includes(s);
}
export function isWaitingStatus(s: string): s is RunWaitingStatus {
  return (RUN_WAITING_STATUSES as readonly string[]).includes(s);
}
export function isInFlightStatus(s: string): s is RunInFlightStatus {
  return (RUN_IN_FLIGHT_STATUSES as readonly string[]).includes(s);
}

// --- State machine ----------------------------------------------------------

/** Allowed (from, to) transitions. Every other pair must be rejected. */
const VALID_TRANSITIONS: ReadonlyArray<readonly [RunStatus, RunStatus]> = [
  // Fresh dispatch.
  ["scheduled", "running"],
  // The runner can skip a scheduled run (gate refusal, agent paused) without
  // ever entering running.
  ["scheduled", "skipped"],
  // Run finishes one of three terminal ways.
  ["running", "done"],
  ["running", "failed"],
  ["running", "skipped"],
  // Run hits a propose gate.
  ["running", "waiting"],
  // Operator decides; the run is queued for resume.
  ["waiting", "pending"],
  // Operator dismissed without deciding — equivalent to a terminal skip from
  // the runner's perspective. (Kept reserved; lifecycle.ts may or may not
  // expose this path — the contract permits it explicitly.)
  ["waiting", "skipped"],
  // Resume picks the pending run back up.
  ["pending", "running"],
];

const TRANSITION_SET = new Set<string>(VALID_TRANSITIONS.map(([f, t]) => `${f}->${t}`));

/** Is a status transition allowed by the lifecycle? Self-transitions are
 *  rejected (the lifecycle never re-stamps to the same status). */
export function validRunTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITION_SET.has(`${from}->${to}`);
}

/** Enumerate every successor for a given status. Useful for runners + UI
 *  state-display drift checks. */
export function nextValidStatuses(from: RunStatus): RunStatus[] {
  return VALID_TRANSITIONS.filter(([f]) => f === from).map(([, t]) => t);
}

// --- Claim ordering ---------------------------------------------------------

/** Sort a candidate queue the way claimNextRun must: `pending` (resume)
 *  before `scheduled` (fresh), then FIFO by scheduledFor. Pure — exercised
 *  offline against synthetic queues. */
export function orderClaimQueue<T extends { status: string; scheduledFor: string | Date | null }>(
  candidates: T[],
): T[] {
  const PRIORITY: Record<string, number> = { pending: 0, scheduled: 1 };
  const claimable = candidates.filter((c) => isClaimableStatus(c.status));
  return [...claimable].sort((a, b) => {
    const pa = PRIORITY[a.status] ?? 9;
    const pb = PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    const ta = a.scheduledFor ? new Date(a.scheduledFor).getTime() : 0;
    const tb = b.scheduledFor ? new Date(b.scheduledFor).getTime() : 0;
    return ta - tb;
  });
}

// --- Bundle shape -----------------------------------------------------------

const VALID_STATUSES_FROZEN: readonly string[] = RUN_STATUSES;

export interface BundleValidationResult {
  ok: boolean;
  reasons: string[];
}

/** Structural Bundle validator — checks the load-bearing fields of bundle.ts
 *  Bundle interface. Pure: feed it the value returned by buildBundle (or a
 *  stub mirroring it) and the validator catches a missing field or a runtime
 *  shape regression that typecheck might miss when intermediate code casts
 *  through `unknown`. */
export function validateBundleShape(b: unknown, baseUrl?: string): BundleValidationResult {
  const reasons: string[] = [];
  if (!b || typeof b !== "object") return { ok: false, reasons: ["bundle is not an object"] };
  const bo = b as Record<string, unknown>;

  // run block
  const run = bo.run as Record<string, unknown> | undefined;
  if (!run) reasons.push("missing run");
  else {
    if (typeof run.id !== "string" || run.id.length === 0) reasons.push("run.id missing");
    if (typeof run.status !== "string") reasons.push("run.status missing");
    else if (!VALID_STATUSES_FROZEN.includes(run.status))
      reasons.push(`run.status '${run.status}' is not in RUN_STATUSES (drift)`);
    if (typeof run.triggerSource !== "string") reasons.push("run.triggerSource missing");
  }

  // agent block
  const agent = bo.agent as Record<string, unknown> | undefined;
  if (!agent) reasons.push("missing agent");
  else {
    for (const f of ["id", "tenantId", "key", "name", "model", "autonomy"]) {
      if (typeof agent[f] !== "string" || (agent[f] as string).length === 0)
        reasons.push(`agent.${f} missing`);
    }
  }

  // arrays of skills/mcp/tools/docs/knowledge/priorLearnings
  for (const arrField of ["docs", "skills", "mcpServers", "tools", "knowledge", "priorLearnings"]) {
    if (!Array.isArray(bo[arrField])) reasons.push(`${arrField} is not an array`);
  }

  // api block
  const api = bo.api as Record<string, unknown> | undefined;
  if (!api) reasons.push("missing api");
  else {
    if (typeof api.statusUrl !== "string") reasons.push("api.statusUrl missing");
    if (typeof api.activityUrl !== "string") reasons.push("api.activityUrl missing");
    if (typeof api.approvalsUrl !== "string") reasons.push("api.approvalsUrl missing");
    const vs = api.validStatuses;
    if (!Array.isArray(vs)) reasons.push("api.validStatuses missing");
    else {
      // The bundle's validStatuses must exactly mirror RUN_STATUSES — drift
      // means the runner is reading from a different status world than the
      // platform. Order is not required; the set match is.
      const got = new Set(vs as string[]);
      const want = new Set(VALID_STATUSES_FROZEN);
      if (got.size !== want.size || [...want].some((s) => !got.has(s)))
        reasons.push("api.validStatuses does not match RUN_STATUSES (drift)");
    }
    if (baseUrl && typeof api.statusUrl === "string" && !api.statusUrl.startsWith(baseUrl))
      reasons.push("api.statusUrl does not begin with baseUrl");
  }

  return { ok: reasons.length === 0, reasons };
}

// --- Approval transition invariant -----------------------------------------

/** Verify a run's STATUS HISTORY around an approval cycle. The lifecycle
 *  promises: a run that hits a propose gate goes running → waiting → pending
 *  → running. Any other sequence around an approval is contract drift.
 *  Caller passes the recorded status sequence (chronological). */
export function validateApprovalCycle(statuses: readonly RunStatus[]): BundleValidationResult {
  const reasons: string[] = [];
  if (statuses.length < 4) reasons.push(`approval cycle has ${statuses.length} states; expected >= 4`);
  // Find the running -> waiting boundary.
  const w = statuses.indexOf("waiting");
  if (w <= 0 || statuses[w - 1] !== "running") {
    reasons.push("expected 'running' immediately before 'waiting'");
    return { ok: false, reasons };
  }
  if (statuses[w + 1] !== "pending") {
    reasons.push("expected 'pending' immediately after 'waiting' (resolveApproval contract)");
  }
  if (statuses[w + 2] !== "running") {
    reasons.push("expected 'running' immediately after 'pending' (claim resumes)");
  }
  return { ok: reasons.length === 0, reasons };
}

// --- Session-end invariant --------------------------------------------------

/** Exactly ONE session_end event per terminal transition. Caller feeds the
 *  recorded events; this checks the invariant. */
export function validateSessionEndInvariant(
  events: ReadonlyArray<{ kind: string; runId: string; rationale?: string | null }>,
  terminalRunsByRunId: ReadonlyMap<string, RunTerminalStatus>,
): BundleValidationResult {
  const reasons: string[] = [];
  const byRun = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "session_end") continue;
    byRun.set(e.runId, (byRun.get(e.runId) ?? 0) + 1);
    const terminalStatus = terminalRunsByRunId.get(e.runId);
    if (terminalStatus && e.rationale && e.rationale !== terminalStatus) {
      reasons.push(`run ${e.runId}: session_end rationale '${e.rationale}' != terminal '${terminalStatus}'`);
    }
  }
  for (const [runId] of terminalRunsByRunId) {
    const c = byRun.get(runId) ?? 0;
    if (c !== 1) reasons.push(`run ${runId}: ${c} session_end events; expected exactly 1`);
  }
  // Extra: events FOR a run not in the terminal set is also drift.
  for (const [runId] of byRun) {
    if (!terminalRunsByRunId.has(runId))
      reasons.push(`session_end emitted for non-terminal run ${runId}`);
  }
  return { ok: reasons.length === 0, reasons };
}

// --- Tools registry contract -----------------------------------------------

/** What the platform promises about every tool row, regardless of tenant. */
export interface ToolContractFacts {
  /** Default for requires_approval is TRUE — deny-by-default safety. */
  requiresApproval: boolean;
  /** (tenant_id, key) must be unique. Caller passes the observed set. */
  key: string;
  tenantId: string;
}

/** Verify a batch of tool rows respects the registry contract. */
export function validateToolsRegistry(rows: readonly ToolContractFacts[]): BundleValidationResult {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const composite = `${r.tenantId}::${r.key}`;
    if (seen.has(composite)) reasons.push(`duplicate (tenant_id, key): ${composite}`);
    seen.add(composite);
  }
  // requires_approval default is enforced at the DB layer, but we surface a
  // drift check: any row that omitted it would land false; flag those.
  for (const r of rows) {
    if (r.requiresApproval !== true) {
      reasons.push(`tool ${r.key} has requires_approval=false — should default to true (deny-by-default)`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}
