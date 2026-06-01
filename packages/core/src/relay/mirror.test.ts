// relay/mirror.test.ts — Wave C guardrail tests for legacy-table coexist-mirror writers.
//
// Three guardrails to lock in:
//   #1 Atomic — if emit() throws, the legacy write rolls back (same tx).
//   #2 Fail-loud — already proven in relay.test.ts via CostInvariantViolation.
//   #3 Idempotent — already proven in relay.test.ts for composeRunSummary.
//
// This file focuses on guardrail #1 via the recordFinding writer and the
// recordAutonomyEvent writer (the two simplest mirror call sites). The
// principle generalizes: every writer that mirrors uses the same
// db.transaction(async tx => ...) pattern; if emit throws, the tx aborts
// and the legacy row is rolled back.
//
// Run: pnpm --filter @agent-os/core run test:mirror

import { recordFinding } from "../security/findings.js";
import { recordAutonomyEvent } from "../lifecycle.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
async function assertRejects(fn: () => Promise<unknown>, match: string, msg: string) {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${msg} — expected throw, resolved`);
  } catch (e) {
    if ((e as Error).message.includes(match)) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg} — wrong error: ${(e as Error).message}`);
    }
  }
}

/** Mock db that tracks every insert across both real tables. When
 *  `txFails` is true, the tx callback is wrapped to mimic a rollback —
 *  the inserts log is rewound to its pre-tx length on throw. */
function makeMirrorDb(opts: { eventName?: string } = {}) {
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  let nextId = 1;

  const baseSelect = (rows: unknown[]) => ({
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  });

  const tableNameOf = (table: object): string => {
    const sym = Object.getOwnPropertySymbols(table).find(
      (s) => s.toString() === "Symbol(drizzle:Name)",
    );
    return sym ? ((table as unknown as Record<symbol, unknown>)[sym] as string) : "?";
  };

  const ops: Record<string, unknown> = {
    select: () => baseSelect([]),
    insert: (table: object) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const tableName = tableNameOf(table);
          const id = `mock-${tableName}-${nextId++}`;
          inserts.push({ table: tableName, values });
          return [{ id, ...values }];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    execute: async () => [] as unknown as never,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // True rollback simulation: snapshot inserts before, restore on throw.
      const snapshot = inserts.length;
      try {
        return await fn(ops);
      } catch (e) {
        inserts.length = snapshot;
        throw e;
      }
    },
  };

  // Drop in a synthetic "bad event_name" to drive emit() to throw and force
  // the tx to roll back, but only if opts.eventName is set.
  return { db: ops as unknown as Parameters<typeof recordFinding>[0], inserts };
}

async function main() {
  console.log("• recordFinding — happy path mirrors to relay_events in same tx");
  const { db: okDb, inserts: okInserts } = makeMirrorDb();
  await recordFinding(okDb, {
    tenantId: "00000000-0000-0000-0000-000000000001",
    category: "isolation",
    severity: "critical",
    title: "cross-tenant leak",
    payload: { run_id: "00000000-0000-0000-0000-00000000000a" },
  });
  assert(
    okInserts.some((i) => i.table === "security_findings"),
    "security_findings row inserted",
  );
  assert(
    okInserts.some(
      (i) => i.table === "relay_events" && i.values.eventName === "finding.recorded",
    ),
    "relay_events row inserted with event_name=finding.recorded",
  );
  assert(okInserts.length === 2, `exactly 2 inserts (findings + relay), got ${okInserts.length}`);

  console.log("• recordFinding — ATOMIC ROLLBACK (Wave C guardrail #1): legacy + relay either both commit or neither");
  // Patch the emit registry by hand: an invalid category that makes the
  // findings insert succeed but tweak we cannot directly here; emit() throws
  // on unknown event names. The cleanest way to drive guardrail #1 in unit-
  // scope: corrupt the schema mock so the relay insert errors after the
  // findings insert lands.
  const corrupt = makeMirrorDb();
  const corruptDb = corrupt.db as unknown as Record<string, unknown>;
  const origInsert = corruptDb.insert as (table: unknown) => unknown;
  corruptDb.insert = (table: object) => {
    const sym = Object.getOwnPropertySymbols(table).find(
      (s) => s.toString() === "Symbol(drizzle:Name)",
    );
    const tableName = sym ? ((table as unknown as Record<symbol, unknown>)[sym] as string) : "?";
    if (tableName === "relay_events") {
      return {
        values: () => ({
          returning: async () => {
            throw new Error("relay insert exploded (simulated emit failure)");
          },
        }),
      };
    }
    return origInsert(table);
  };
  await assertRejects(
    () =>
      recordFinding(corruptDb as unknown as Parameters<typeof recordFinding>[0], {
        tenantId: "t1",
        category: "anomaly",
        severity: "high",
        title: "drift",
      }),
    "relay insert exploded",
    "recordFinding re-throws the emit failure (no catch-and-swallow)",
  );
  assert(
    corrupt.inserts.length === 0,
    `tx rolled back — no inserts persist (got ${corrupt.inserts.length})`,
  );

  console.log("• recordAutonomyEvent — kind=allow mirrors to autonomy.allowed");
  const { db: allowDb, inserts: allowInserts } = makeMirrorDb();
  await recordAutonomyEvent(allowDb, {
    tenantId: "t1",
    runId: "r1",
    agentId: "a1",
    kind: "allow",
    toolName: "Slack",
  });
  assert(
    allowInserts.some(
      (i) => i.table === "relay_events" && i.values.eventName === "autonomy.allowed",
    ),
    "kind=allow → relay autonomy.allowed",
  );

  console.log("• recordAutonomyEvent — kind=session_end does NOT mirror (avoid double-count)");
  const { db: seDb, inserts: seInserts } = makeMirrorDb();
  await recordAutonomyEvent(seDb, {
    tenantId: "t1",
    runId: "r1",
    agentId: "a1",
    kind: "session_end",
    rationale: "done",
  });
  assert(
    seInserts.some((i) => i.table === "autonomy_events"),
    "autonomy_events row still written",
  );
  assert(
    !seInserts.some((i) => i.table === "relay_events"),
    "no relay_events emit for session_end (terminal run.* event handles this)",
  );

  console.log("• recordAutonomyEvent — kind=stop does NOT mirror (no canonical peer yet)");
  const { db: stopDb, inserts: stopInserts } = makeMirrorDb();
  await recordAutonomyEvent(stopDb, {
    tenantId: "t1",
    runId: "r1",
    agentId: "a1",
    kind: "stop",
    rationale: "budget exhausted",
  });
  assert(
    stopInserts.some((i) => i.table === "autonomy_events"),
    "autonomy_events row still written for kind=stop",
  );
  assert(
    !stopInserts.some((i) => i.table === "relay_events"),
    "no relay_events emit for kind=stop (unmapped in AUTONOMY_KIND_TO_RELAY)",
  );

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
