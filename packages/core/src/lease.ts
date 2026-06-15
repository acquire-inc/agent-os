// Agent lease arbitration — the "don't overlap" invariant (I-003).
//
// Today two agents can be dispatched against the same target resource at the
// same moment (same lead, same connector record, same objective, same tool
// invocation) and step on each other: duplicate writes, contradictory
// proposals, double-charged budget. The runner has no notion of "this work is
// already in flight by another agent." That's the operator-visible "slop /
// interfere" problem.
//
// This module adds a thin SEQUENCING layer on top of the existing dispatch:
// a target resource (e.g. "lead/12345", "objective/abc", "tool.connector.slack
// /channel-9") can be HELD by exactly one agent run at a time via a LEASE.
// A second agent asking for the same lease while it's held gets a CONFLICT
// decision (its caller chooses: yield, queue, or — only for higher-priority
// work — preempt). Leases auto-expire (TTL) so a crashed runner can't park
// resources forever.
//
// Doctrine encoded as hard rules (not defaults):
//   - A can't-fail agent NEVER yields to a non-cant-fail agent on the same
//     target. The cant-fail run wins arbitration; the lower-priority lease is
//     considered conflicted. (Tier wins. Override loses. Same doctrine as the
//     model router.)
//   - A can't-fail agent's lease NEVER auto-expires below the doctrine floor
//     of 5 minutes — short-TTL games can't be used to kick a critical run.
//   - Self-renewals (same owner run) ALWAYS grant. Preemption never happens
//     between two runs of the same agent — that's the agent's own sequence.
//   - Lease decisions are EMITTED via the relay (audit trail) so an operator
//     can see "agent X was held off by agent Y on resource Z at time T."
//
// Pure decision functions + sink-based runner. Mirrors objective.ts,
// improve.ts, critic.ts, eval/circuit-breaker.ts so the DB I/O stays injected
// and the whole flow is unit-testable without a live Postgres.

/** Identifier of the resource being held. The platform deliberately keeps
 *  this as (kind, key) strings: any future resource type (lead, deal,
 *  connector record, tool invocation, sub-agent slot) participates by picking
 *  a stable key without a schema change.
 *
 *  WR-04 tenant scoping (REQUIRED): the `key` MUST be tenant-prefixed —
 *  `{tenantId}/{resource_id}`. See docs/lease-arbitration.md § Tenant scoping
 *  for rationale and the runtime guard at assertTenantScopedKey(). Without
 *  the prefix, two tenants that both use `lead/L-123` as a key would
 *  collide and a cant-fail run in tenant A could preempt tenant B's
 *  lease — a cross-tenant safety bug that no other layer catches because
 *  agent_leases is V2-gated and the pure decideLease() carries no tenant
 *  assertion of its own. */
export interface LeaseTarget {
  kind: string;
  key: string;
}

/** WR-04 runtime guard: every lease load/acquire MUST be against a target
 *  whose key starts with `{tenantId}/`. Throws on mismatch so a regression
 *  fails loud at the boundary instead of silently writing a cross-tenant-
 *  shaped row. The sink calls this before the SQL; pure tests construct
 *  targets that already include the prefix. */
export function assertTenantScopedKey(target: LeaseTarget, tenantId: string): void {
  if (!tenantId || tenantId.length === 0) {
    throw new Error(
      `lease tenant_id required — refusing to operate on target ${target.kind}/${target.key}`,
    );
  }
  if (!target.key.startsWith(`${tenantId}/`)) {
    throw new Error(
      `lease target key not tenant-prefixed — refusing to load/acquire ` +
        `(tenant=${tenantId}, key=${target.key})`,
    );
  }
}

export function leaseTargetEq(a: LeaseTarget, b: LeaseTarget): boolean {
  return a.kind === b.kind && a.key === b.key;
}

export function formatLeaseTarget(t: LeaseTarget): string {
  return `${t.kind}/${t.key}`;
}

export interface LeaseHolder {
  ownerAgentId: string;
  ownerRunId: string;
  ownerIsCantFail: boolean;
}

export interface ActiveLease extends LeaseHolder {
  id: string;
  target: LeaseTarget;
  acquiredAt: string; // ISO
  expiresAt: string;  // ISO
  releasedAt: string | null;
}

export type LeaseDecisionKind = "grant" | "renew" | "conflict" | "preempt";

export interface LeaseDecision {
  kind: LeaseDecisionKind;
  /** When kind === "conflict" or "preempt", who held it. */
  heldBy: LeaseHolder | null;
  rationale: string;
  /** Suggested back-off for callers receiving "conflict" — they may
   *  re-request after this many milliseconds. Null for grant/renew. */
  retryAfterMs: number | null;
}

export const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
export const CANTFAIL_LEASE_FLOOR_MS = 5 * 60 * 1000;
export const DEFAULT_CONFLICT_BACKOFF_MS = 15 * 1000;

/** Clamp the requested TTL: never below cant-fail floor for cant-fail
 *  requesters, never above 1h for anyone (don't let an agent park a resource
 *  for the whole day). */
export function clampLeaseTtl(requestedMs: number, requesterIsCantFail: boolean): number {
  const HOUR = 60 * 60 * 1000;
  let ttl = Math.max(1_000, Math.min(requestedMs, HOUR));
  if (requesterIsCantFail) ttl = Math.max(ttl, CANTFAIL_LEASE_FLOOR_MS);
  return ttl;
}

/** Has a lease expired as of `now`? Released leases are considered expired
 *  regardless of expires_at. */
export function isLeaseActive(lease: Pick<ActiveLease, "expiresAt" | "releasedAt">, nowIso: string): boolean {
  if (lease.releasedAt !== null) return false;
  return lease.expiresAt > nowIso;
}

/**
 * Decide what to do with a lease request given the current active lease
 * (if any) on the same target. Pure: no DB, no clock — `nowIso` is passed in
 * so tests can pin time.
 *
 * Rules in priority order:
 *   1. No active lease (or expired) → GRANT.
 *   2. Same owner run → RENEW (self-extend).
 *   3. Requester is cant-fail and holder is NOT → PREEMPT. Doctrine: tier
 *      wins. The held run keeps executing — preempt only frees the LEASE so
 *      the cant-fail can act; it does not interrupt the prior run.
 *   4. Otherwise → CONFLICT. Caller chooses yield/queue.
 */
export function decideLease(input: {
  request: LeaseHolder;
  active: ActiveLease | null;
  nowIso: string;
}): LeaseDecision {
  const { request, active, nowIso } = input;
  if (!active || !isLeaseActive(active, nowIso)) {
    return { kind: "grant", heldBy: null, rationale: "target free", retryAfterMs: null };
  }
  if (active.ownerRunId === request.ownerRunId) {
    return {
      kind: "renew",
      heldBy: active,
      rationale: "same owner run — self-renew",
      retryAfterMs: null,
    };
  }
  if (request.ownerIsCantFail && !active.ownerIsCantFail) {
    return {
      kind: "preempt",
      heldBy: active,
      rationale: `cant-fail agent ${request.ownerAgentId} preempts non-cant-fail ${active.ownerAgentId} (tier wins)`,
      retryAfterMs: null,
    };
  }
  return {
    kind: "conflict",
    heldBy: active,
    rationale: `target held by run ${active.ownerRunId} (agent ${active.ownerAgentId}) until ${active.expiresAt}`,
    retryAfterMs: DEFAULT_CONFLICT_BACKOFF_MS,
  };
}

// --- Sink-based runner ------------------------------------------------------

export interface LeaseSink {
  /** Load the currently held lease on this target (released_at IS NULL,
   *  expires_at > now). Null if none. The sink chooses whether to enforce
   *  freshness in SQL or hand back any active row and let the pure decision
   *  filter — both are valid; the existing test fakes return the row and
   *  let the decision do the filtering. */
  loadActive(target: LeaseTarget, nowIso: string): Promise<ActiveLease | null>;
  /** Insert a new lease row. Returns the new active lease. */
  acquire(input: {
    target: LeaseTarget;
    holder: LeaseHolder;
    ttlMs: number;
    nowIso: string;
  }): Promise<ActiveLease>;
  /** Release the prior lease (preempt path) so the unique active-lease index
   *  doesn't block the new acquire. */
  release(leaseId: string, nowIso: string): Promise<void>;
  /** Extend an existing self-owned lease. */
  renew(leaseId: string, newExpiresAt: string): Promise<ActiveLease>;
  /** Emit `agent.lease_granted` / `agent.lease_conflicted` / `agent.lease_preempted`
   *  to the relay. */
  emit(input: {
    target: LeaseTarget;
    decision: LeaseDecision;
    requestedBy: LeaseHolder;
  }): Promise<void>;
}

export interface LeaseRunResult {
  decision: LeaseDecision;
  /** The lease the requester now owns, when decision is grant/renew/preempt. */
  lease: ActiveLease | null;
}

/**
 * Request a lease for a target. The caller is the agent dispatch path
 * (runner pre-tool / scheduler pre-claim).
 */
export async function requestLease(
  input: {
    target: LeaseTarget;
    requestedBy: LeaseHolder;
    ttlMs?: number;
    nowIso?: string;
  },
  sink: LeaseSink,
): Promise<LeaseRunResult> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const ttlMs = clampLeaseTtl(input.ttlMs ?? DEFAULT_LEASE_TTL_MS, input.requestedBy.ownerIsCantFail);
  const active = await sink.loadActive(input.target, nowIso);
  const decision = decideLease({ request: input.requestedBy, active, nowIso });

  let lease: ActiveLease | null = null;
  if (decision.kind === "grant") {
    lease = await sink.acquire({ target: input.target, holder: input.requestedBy, ttlMs, nowIso });
  } else if (decision.kind === "renew") {
    const newExpiresAt = new Date(new Date(nowIso).getTime() + ttlMs).toISOString();
    lease = await sink.renew(active!.id, newExpiresAt);
  } else if (decision.kind === "preempt") {
    await sink.release(active!.id, nowIso);
    lease = await sink.acquire({ target: input.target, holder: input.requestedBy, ttlMs, nowIso });
  }
  await sink.emit({ target: input.target, decision, requestedBy: input.requestedBy });
  return { decision, lease };
}

/** Release a lease on terminal run finish (or explicit operator action). The
 *  runner calls this on every exit path (success, fail, skip) — pairs with
 *  the existing budget reserve/commit/release pattern. */
export async function releaseLease(
  leaseId: string,
  sink: Pick<LeaseSink, "release">,
  nowIso?: string,
): Promise<void> {
  return sink.release(leaseId, nowIso ?? new Date().toISOString());
}
