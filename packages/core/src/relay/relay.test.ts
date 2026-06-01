// relay/relay.test.ts — unit tests for the Relay event bus.
// No live DB. Run: pnpm --filter @agent-os/core run test:relay

import {
  EVENT_NAMES,
  isEventName,
  emit,
  composeRunSummary,
  CostInvariantViolation,
} from "./index.js";

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

/** Minimal mock Db that captures inserts + supports the .select().from().where().limit() chain.
 *  Wave C: now supports .transaction(fn) — fn(db) is called and its return value
 *  returned. The mock cannot ACTUALLY roll back, so tests assert intent (throw
 *  semantics) rather than DB state. */
function mockDb(opts: {
  existingRow?: Record<string, unknown> | null;
  existingRun?: Record<string, unknown> | null;
  /** When set, simulates a stale runs.cost_usd post-insert by patching the
   *  inserted row's costActualUsd to this value. Used to drive the cost-
   *  invariant violation path. */
  forceSummaryCost?: string;
} = {}) {
  const inserts: Array<{ table: string; values: unknown; returnedId: string }> = [];
  const executes: string[] = [];
  let nextId = 1;

  const baseSelectChain = (rows: unknown[]) => ({
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  });

  const db: Record<string, unknown> = {
    select: (() => {
      let callIdx = 0;
      return () => {
        const idx = callIdx++;
        if (idx === 0) return baseSelectChain(opts.existingRow ? [opts.existingRow] : []);
        return baseSelectChain(opts.existingRun ? [opts.existingRun] : []);
      };
    })(),
    insert: (table: { _: { name?: string } } | unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const id = `mock-id-${nextId++}`;
          const tableName = (table as { _: { name?: string } })._?.name ?? "?";
          inserts.push({ table: tableName, values, returnedId: id });
          // Drive cost-invariant violation when configured.
          if (opts.forceSummaryCost && tableName === "?") {
            return [{ id, ...values, costActualUsd: opts.forceSummaryCost }];
          }
          return [{ id, ...values }];
        },
      }),
    }),
    execute: async (q: { queryChunks?: unknown[] }) => {
      const chunks = (q.queryChunks ?? []) as Array<{ value?: string[] } | unknown>;
      let text = "";
      for (const c of chunks) {
        if (c && typeof c === "object" && "value" in c && Array.isArray((c as { value: string[] }).value)) {
          text += (c as { value: string[] }).value.join("");
        }
      }
      executes.push(text);
      if (text.includes("tool_calls")) return [{ tool_calls: 0 }] as unknown as never;
      if (text.includes("findings_count")) return [{ findings_count: 0 }] as unknown as never;
      if (text.includes("approvals_count")) return [{ approvals_count: 0 }] as unknown as never;
      return [] as unknown as never;
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return { db: db as unknown as Parameters<typeof emit>[0], inserts, executes };
}

async function main() {
  console.log("• EVENT_NAMES — closed namespace");
  assert(Array.isArray(EVENT_NAMES) && EVENT_NAMES.length >= 24, `namespace has 24+ names (got ${EVENT_NAMES.length})`);
  assert(isEventName("run.started"), "isEventName('run.started') returns true");
  assert(!isEventName("run.bogus"), "isEventName('run.bogus') returns false");
  assert(isEventName("cantfail.model_violation"), "cantfail.model_violation is registered (Open Q #1 RESOLVED)");
  assert(isEventName("architect.refused"), "architect.refused is registered (CRA blocklist contract)");
  assert(isEventName("cantfail.cra_violation"), "cantfail.cra_violation is registered (CRA runtime guard)");

  console.log("• emit() — rejects unknown event names BEFORE the DB insert");
  const { db: rejectDb } = mockDb();
  await assertRejects(
    () => emit(rejectDb, {
      tenantId: "t1",
      eventName: "totally.made.up",
      actor: "system",
    }),
    "unknown event_name",
    "throws on unknown event_name",
  );

  console.log("• emit() — happy path inserts and returns row");
  const { db: emitDb, inserts: emitInserts } = mockDb();
  const row = await emit(emitDb, {
    tenantId: "t1",
    eventName: "run.started",
    actor: "system",
    runId: "r1",
    agentId: "a1",
    payload: { trigger_source: "cron" },
  });
  assert(typeof row.id === "string", "returns row with id");
  assert(emitInserts.length === 1, "one insert call");
  const insertValues = emitInserts[0]!.values as Record<string, unknown>;
  assert(insertValues.eventName === "run.started", "event_name preserved");
  assert(insertValues.consentScope === "tenant_only", "consent_scope defaults to tenant_only");
  assert(insertValues.piiClass === "none", "pii_class defaults to none");
  assert(insertValues.actor === "system", "actor preserved");

  console.log("• emit() — idempotency via eventKey returns existing row, no insert");
  const existing = { id: "existing-row-id", tenantId: "t1", eventKey: "dedupe-key", eventName: "run.started" };
  const { db: dedupeDb, inserts: dedupeInserts } = mockDb({ existingRow: existing });
  const dedupeRow = await emit(dedupeDb, {
    tenantId: "t1",
    eventName: "run.started",
    actor: "system",
    eventKey: "dedupe-key",
  });
  assert(dedupeRow.id === "existing-row-id", "returns the existing row id");
  assert(dedupeInserts.length === 0, "no insert performed on dedupe");

  console.log("• composeRunSummary() — throws when run not found");
  const { db: noRunDb } = mockDb({ existingRun: null });
  await assertRejects(
    () => composeRunSummary(noRunDb, { runId: "missing", status: "done" }),
    "not found",
    "throws when run row doesn't exist",
  );

  console.log("• composeRunSummary() — throws when terminal stamps missing");
  const halfStampedRun = {
    id: "r1",
    tenantId: "t1",
    agentId: "a1",
    startedAt: new Date("2026-06-01T00:00:00Z"),
    endedAt: null,
    costUsd: "0.50",
    tokensIn: 100,
    tokensOut: 200,
    summary: "x",
  };
  const { db: halfDb } = mockDb({ existingRun: halfStampedRun });
  await assertRejects(
    () => composeRunSummary(halfDb, { runId: "r1", status: "done" }),
    "missing startedAt/endedAt",
    "throws when endedAt is null",
  );

  console.log("• composeRunSummary() — happy path: cost mirrors runs.cost_usd (launch-gate invariant)");
  const completeRun = {
    id: "r2",
    tenantId: "t1",
    agentId: "a2",
    startedAt: new Date("2026-06-01T00:00:00Z"),
    endedAt: new Date("2026-06-01T00:00:42Z"),
    costUsd: "1.2345",
    tokensIn: 100,
    tokensOut: 200,
    summary: "did the thing",
  };
  const { db: doneDb, inserts: doneInserts } = mockDb({ existingRow: null, existingRun: completeRun });
  const summary = await composeRunSummary(doneDb, {
    runId: "r2",
    status: "done",
    deliverableKind: "document",
    deliverableRef: "/tmp/out.md",
    evidencePaths: ["/tmp/out.md"],
  });
  assert(summary.status === "done", "status persisted");
  const summaryValues = doneInserts[0]!.values as Record<string, unknown>;
  assert(
    summaryValues.costActualUsd === "1.2345",
    "INVARIANT: cost_actual_usd === runs.cost_usd (launch-gate criterion)",
  );
  assert(summaryValues.tokensIn === 100, "tokens_in mirrored");
  assert(summaryValues.tokensOut === 200, "tokens_out mirrored");
  assert(summaryValues.durationMs === 42000, "duration computed from started/ended");
  assert(
    Array.isArray(summaryValues.evidencePaths) &&
      (summaryValues.evidencePaths as string[])[0] === "/tmp/out.md",
    "evidence_paths preserved",
  );

  console.log("• composeRunSummary() — idempotent: returns existing summary, no insert (Wave C guardrail #3)");
  const existingSummary = { id: "summary-1", runId: "r3", tenantId: "t1", status: "done" };
  const { db: idemDb, inserts: idemInserts } = mockDb({ existingRow: existingSummary });
  const idemRow = await composeRunSummary(idemDb, { runId: "r3", status: "done" });
  assert(idemRow.id === "summary-1", "returns existing summary id");
  assert(idemInserts.length === 0, "no insert performed on idempotent call");

  console.log("• composeRunSummary() — FAIL-LOUD on cost mismatch (Wave C guardrail #2)");
  // Drive a cost mismatch: runs.cost_usd = "1.2345" but the mock forces the
  // inserted summary's costActualUsd to "0" so they diverge. The composer
  // must throw CostInvariantViolation; the (mocked, no-op) tx rolls back.
  const driftRun = {
    id: "r4",
    tenantId: "t1",
    agentId: "a4",
    startedAt: new Date("2026-06-01T00:00:00Z"),
    endedAt: new Date("2026-06-01T00:00:30Z"),
    costUsd: "1.2345",
    tokensIn: 50,
    tokensOut: 75,
    summary: "drift",
  };
  const { db: driftDb } = mockDb({
    existingRow: null,
    existingRun: driftRun,
    forceSummaryCost: "0.0000",
  });
  let caught: unknown;
  try {
    await composeRunSummary(driftDb, { runId: "r4", status: "done" });
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof CostInvariantViolation, "throws CostInvariantViolation on mismatch");
  const violation = caught as CostInvariantViolation;
  assert(violation.runId === "r4", "violation carries runId");
  assert(violation.runUsd === "1.2345", "violation carries runs.cost_usd value");
  assert(violation.summaryUsd === "0.0000", "violation carries the offending summary cost");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
