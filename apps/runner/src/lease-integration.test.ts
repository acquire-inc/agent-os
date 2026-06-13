// Offline test for the runner-side lease-integration wrapper.
// Run: pnpm --filter runner test:lease-integration
import type { ActiveLease, LeaseSink, LeaseTarget } from "@agent-os/core";
import { acquireLeaseForToolCall } from "./lease-integration.js";

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

const T0 = "2026-06-13T00:00:00.000Z";

function makeSink(active: ActiveLease | null): LeaseSink {
  return {
    async loadActive() {
      return active;
    },
    async acquire(input) {
      return {
        id: "new-lease",
        target: input.target,
        ownerAgentId: input.holder.ownerAgentId,
        ownerRunId: input.holder.ownerRunId,
        ownerIsCantFail: input.holder.ownerIsCantFail,
        acquiredAt: input.nowIso,
        expiresAt: new Date(new Date(input.nowIso).getTime() + input.ttlMs).toISOString(),
        releasedAt: null,
      };
    },
    async release() {},
    async renew(_id, newExpiresAt) {
      return { ...active!, id: _id, expiresAt: newExpiresAt };
    },
    async emit() {},
  };
}

const lead = (key = "L-1"): LeaseTarget => ({ kind: "lead", key });

async function main() {
  console.log("\n[acquireLeaseForToolCall — null target short-circuits]");
  {
    const r = await acquireLeaseForToolCall(
      { runId: "r1", agentId: "a1", agentKey: "ad-ops", isCantFail: false, target: null },
      makeSink(null),
    );
    assert(r.proceed === true, "null target → proceed");
    assert(r.lease === null, "null target → no lease handed back");
    assert(/not sequenceable/.test(r.rationale), "rationale says not sequenceable");
  }

  console.log("\n[acquireLeaseForToolCall — clean grant]");
  {
    const r = await acquireLeaseForToolCall(
      { runId: "r1", agentId: "a1", agentKey: "ad-ops", isCantFail: false, target: lead() },
      makeSink(null),
    );
    assert(r.proceed === true && r.lease !== null, "no contention → proceed with lease");
  }

  console.log("\n[acquireLeaseForToolCall — conflict yields with back-off]");
  {
    const held: ActiveLease = {
      id: "lease-held",
      target: lead(),
      ownerAgentId: "other",
      ownerRunId: "rother",
      ownerIsCantFail: false,
      acquiredAt: T0,
      expiresAt: "2999-01-01T00:00:00.000Z",
      releasedAt: null,
    };
    const r = await acquireLeaseForToolCall(
      { runId: "r1", agentId: "a1", agentKey: "ad-ops", isCantFail: false, target: lead() },
      makeSink(held),
    );
    assert(r.proceed === false, "held by another → yield");
    assert(r.proceed === false && r.retryAfterMs > 0, "back-off hint > 0");
  }

  console.log("\n[acquireLeaseForToolCall — cant-fail preempts non-cant-fail]");
  {
    const held: ActiveLease = {
      id: "lease-held",
      target: lead(),
      ownerAgentId: "other",
      ownerRunId: "rother",
      ownerIsCantFail: false,
      acquiredAt: T0,
      expiresAt: "2999-01-01T00:00:00.000Z",
      releasedAt: null,
    };
    const r = await acquireLeaseForToolCall(
      { runId: "r1", agentId: "ac", agentKey: "ad-claim-compliance", isCantFail: true, target: lead() },
      makeSink(held),
    );
    assert(r.proceed === true, "cant-fail preempts → proceed");
    assert(r.proceed === true && r.lease !== null, "preempt returns the new lease");
  }

  console.log("\n[acquireLeaseForToolCall — self-renew on same run]");
  {
    const held: ActiveLease = {
      id: "lease-self",
      target: lead(),
      ownerAgentId: "a1",
      ownerRunId: "r1",
      ownerIsCantFail: false,
      acquiredAt: T0,
      expiresAt: "2999-01-01T00:00:00.000Z",
      releasedAt: null,
    };
    const r = await acquireLeaseForToolCall(
      { runId: "r1", agentId: "a1", agentKey: "ad-ops", isCantFail: false, target: lead() },
      makeSink(held),
    );
    assert(r.proceed === true, "same run re-acquires → proceed (renew)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
