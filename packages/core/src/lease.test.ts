// Pure unit tests for agent lease arbitration (no DB).
// Run: pnpm --filter @agent-os/core test:lease
import {
  CANTFAIL_LEASE_FLOOR_MS,
  DEFAULT_CONFLICT_BACKOFF_MS,
  DEFAULT_LEASE_TTL_MS,
  clampLeaseTtl,
  decideLease,
  isLeaseActive,
  leaseTargetEq,
  formatLeaseTarget,
  releaseLease,
  requestLease,
  type ActiveLease,
  type LeaseSink,
  type LeaseTarget,
} from "./lease.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const T0 = "2026-06-12T17:00:00.000Z";
const T1m = "2026-06-12T17:01:00.000Z";
const T6m = "2026-06-12T17:06:00.000Z"; // beyond default TTL

const target = (k = "lead", key = "L-1"): LeaseTarget => ({ kind: k, key });

const lease = (overrides: Partial<ActiveLease> = {}): ActiveLease => ({
  id: "lease-A",
  target: target(),
  ownerAgentId: "agent-X",
  ownerRunId: "run-X",
  ownerIsCantFail: false,
  acquiredAt: T0,
  expiresAt: T1m,
  releasedAt: null,
  ...overrides,
});

async function main() {
  console.log("\n[target equality + format]");
  assert(leaseTargetEq({ kind: "k", key: "1" }, { kind: "k", key: "1" }), "same kind+key are equal");
  assert(!leaseTargetEq({ kind: "k", key: "1" }, { kind: "k", key: "2" }), "different key not equal");
  assert(formatLeaseTarget({ kind: "lead", key: "L-1" }) === "lead/L-1", "format target as kind/key");

  console.log("\n[isLeaseActive — expiry + release]");
  assert(isLeaseActive(lease({ expiresAt: T1m }), T0), "not yet expired → active");
  assert(!isLeaseActive(lease({ expiresAt: T1m }), T6m), "past expires_at → not active");
  assert(!isLeaseActive(lease({ releasedAt: T0 }), T0), "explicitly released → not active regardless of expiresAt");

  console.log("\n[clampLeaseTtl — floors and ceilings]");
  assert(clampLeaseTtl(60_000, false) === 60_000, "in-range request honored");
  assert(clampLeaseTtl(500, false) === 1_000, "tiny request raised to 1s floor");
  assert(clampLeaseTtl(99_999_999, false) === 3_600_000, "huge request capped at 1h");
  assert(clampLeaseTtl(1_000, true) === CANTFAIL_LEASE_FLOOR_MS, "cant-fail requester clamped UP to floor");
  assert(clampLeaseTtl(10 * 60_000, true) === 10 * 60_000, "cant-fail above floor honored");

  console.log("\n[decideLease — grant / renew / conflict / preempt]");
  {
    const d = decideLease({
      request: { ownerAgentId: "ar", ownerRunId: "rr", ownerIsCantFail: false },
      active: null,
      nowIso: T0,
    });
    assert(d.kind === "grant" && d.heldBy === null, "no active lease → grant");
  }
  {
    const d = decideLease({
      request: { ownerAgentId: "ar", ownerRunId: "rr", ownerIsCantFail: false },
      active: lease({ expiresAt: T1m }),
      nowIso: T6m,
    });
    assert(d.kind === "grant", "expired active treated as no lease → grant");
  }
  {
    const active = lease();
    const d = decideLease({
      request: { ownerAgentId: active.ownerAgentId, ownerRunId: active.ownerRunId, ownerIsCantFail: false },
      active,
      nowIso: T0,
    });
    assert(d.kind === "renew" && d.heldBy?.ownerRunId === active.ownerRunId, "same owner run → renew");
  }
  {
    const active = lease();
    const d = decideLease({
      request: { ownerAgentId: "ar", ownerRunId: "rr", ownerIsCantFail: false },
      active,
      nowIso: T0,
    });
    assert(d.kind === "conflict", "different owner, both non-cant-fail → conflict");
    assert(d.retryAfterMs === DEFAULT_CONFLICT_BACKOFF_MS, "conflict carries back-off");
    assert(d.heldBy?.ownerAgentId === "agent-X", "conflict reports the holder");
  }
  {
    const active = lease({ ownerIsCantFail: false });
    const d = decideLease({
      request: { ownerAgentId: "ar-critical", ownerRunId: "rr-critical", ownerIsCantFail: true },
      active,
      nowIso: T0,
    });
    assert(d.kind === "preempt", "cant-fail requester vs non-cant-fail holder → preempt (tier wins)");
    assert(/tier wins/.test(d.rationale), "rationale names the doctrine");
  }
  {
    const active = lease({ ownerIsCantFail: true });
    const d = decideLease({
      request: { ownerAgentId: "ar", ownerRunId: "rr", ownerIsCantFail: false },
      active,
      nowIso: T0,
    });
    assert(d.kind === "conflict", "non-cant-fail requester does NOT preempt cant-fail holder");
  }
  {
    const active = lease({ ownerIsCantFail: true });
    const d = decideLease({
      request: { ownerAgentId: "ar", ownerRunId: "rr", ownerIsCantFail: true },
      active,
      nowIso: T0,
    });
    assert(d.kind === "conflict", "cant-fail vs cant-fail does NOT preempt — equals don't fight");
  }

  console.log("\n[requestLease — sink wiring: grant path]");
  {
    const sink = makeSpySink({ active: null });
    const r = await requestLease(
      { target: target(), requestedBy: { ownerAgentId: "a", ownerRunId: "r", ownerIsCantFail: false }, nowIso: T0 },
      sink,
    );
    assert(r.decision.kind === "grant", "grant returned");
    assert(r.lease !== null, "lease handed back");
    assert(sink.calls.acquired.length === 1, "acquire called once");
    assert(sink.calls.released.length === 0, "no release on grant");
    assert(sink.calls.emits.length === 1, "lease decision emitted");
  }

  console.log("\n[requestLease — renew path]");
  {
    const existing = lease({ ownerAgentId: "a", ownerRunId: "r" });
    const sink = makeSpySink({ active: existing });
    const r = await requestLease(
      { target: target(), requestedBy: { ownerAgentId: "a", ownerRunId: "r", ownerIsCantFail: false }, nowIso: T0, ttlMs: 60_000 },
      sink,
    );
    assert(r.decision.kind === "renew", "renew returned");
    assert(sink.calls.renewed.length === 1, "renew called once");
    assert(sink.calls.acquired.length === 0, "no fresh acquire on renew");
  }

  console.log("\n[requestLease — conflict path: no DB write, just emit + back-off]");
  {
    const sink = makeSpySink({ active: lease() });
    const r = await requestLease(
      { target: target(), requestedBy: { ownerAgentId: "b", ownerRunId: "rb", ownerIsCantFail: false }, nowIso: T0 },
      sink,
    );
    assert(r.decision.kind === "conflict", "conflict returned");
    assert(r.lease === null, "no lease handed back on conflict");
    assert(sink.calls.acquired.length === 0, "no acquire on conflict");
    assert(sink.calls.released.length === 0, "no release on conflict");
    assert(sink.calls.emits.length === 1, "conflict emitted (operator audit)");
    assert(r.decision.retryAfterMs === DEFAULT_CONFLICT_BACKOFF_MS, "caller gets back-off hint");
  }

  console.log("\n[requestLease — preempt path: release old then acquire new]");
  {
    const held = lease({ id: "lease-old", ownerIsCantFail: false });
    const sink = makeSpySink({ active: held });
    const r = await requestLease(
      {
        target: target(),
        requestedBy: { ownerAgentId: "critical", ownerRunId: "r-crit", ownerIsCantFail: true },
        nowIso: T0,
      },
      sink,
    );
    assert(r.decision.kind === "preempt", "cant-fail requester preempts");
    assert(sink.calls.released.includes("lease-old"), "old lease released BEFORE new acquire");
    assert(sink.calls.acquired.length === 1, "new lease acquired");
    // Order matters: release must precede acquire so the unique-active index
    // doesn't reject the new insert.
    const releaseIdx = sink.calls.order.indexOf("release");
    const acquireIdx = sink.calls.order.indexOf("acquire");
    assert(releaseIdx >= 0 && acquireIdx > releaseIdx, "release happened before acquire (ordering invariant)");
    // Cant-fail acquires honor the floor TTL.
    assert(sink.calls.acquired[0]!.ttlMs >= CANTFAIL_LEASE_FLOOR_MS, "preempting cant-fail acquire respects TTL floor");
  }

  console.log("\n[releaseLease — direct release]");
  {
    const sink = makeSpySink({ active: null });
    await releaseLease("lease-Z", sink, T0);
    assert(sink.calls.released.length === 1 && sink.calls.released[0] === "lease-Z", "release writes through the sink");
  }

  console.log("\n[default TTL applied when not provided]");
  {
    const sink = makeSpySink({ active: null });
    await requestLease(
      { target: target(), requestedBy: { ownerAgentId: "a", ownerRunId: "r", ownerIsCantFail: false }, nowIso: T0 },
      sink,
    );
    assert(sink.calls.acquired[0]!.ttlMs === DEFAULT_LEASE_TTL_MS, "DEFAULT_LEASE_TTL_MS used when ttlMs absent");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

interface SpyState {
  active: ActiveLease | null;
}

interface AcquireCall {
  target: LeaseTarget;
  holder: { ownerAgentId: string; ownerRunId: string; ownerIsCantFail: boolean };
  ttlMs: number;
}

function makeSpySink(state: SpyState): LeaseSink & {
  calls: {
    acquired: AcquireCall[];
    released: string[];
    renewed: string[];
    emits: unknown[];
    order: string[];
  };
} {
  const calls = {
    acquired: [] as AcquireCall[],
    released: [] as string[],
    renewed: [] as string[],
    emits: [] as unknown[],
    order: [] as string[],
  };
  return {
    calls,
    async loadActive() {
      return state.active;
    },
    async acquire(input) {
      calls.order.push("acquire");
      calls.acquired.push({ target: input.target, holder: input.holder, ttlMs: input.ttlMs });
      return {
        id: `new-${calls.acquired.length}`,
        target: input.target,
        ownerAgentId: input.holder.ownerAgentId,
        ownerRunId: input.holder.ownerRunId,
        ownerIsCantFail: input.holder.ownerIsCantFail,
        acquiredAt: input.nowIso,
        expiresAt: new Date(new Date(input.nowIso).getTime() + input.ttlMs).toISOString(),
        releasedAt: null,
      };
    },
    async release(leaseId) {
      calls.order.push("release");
      calls.released.push(leaseId);
    },
    async renew(leaseId, newExpiresAt) {
      calls.order.push("renew");
      calls.renewed.push(leaseId);
      return { ...state.active!, id: leaseId, expiresAt: newExpiresAt };
    },
    async emit(input) {
      calls.emits.push(input);
    },
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
