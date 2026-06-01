// relay/waved.test.ts — Wave D emit-site tests.
//
// Wave D wires the remaining canonical events at their server-side data-flow
// points: run.started (claimNextRun), tool.result (writeAudit). Both are
// atomic with their legacy write (runs claim / audit_log insert). tool.dispatched
// (runner PreToolUse) and knowledge.retrieved (API /next closure) are wired in
// the runner/api packages and tested there / by inspection.
//
// Run: pnpm --filter @agent-os/core run test:waved

import { writeAudit } from "../cost.js";
import { claimNextRun } from "../claim.js";

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

const tableNameOf = (table: object): string => {
  const sym = Object.getOwnPropertySymbols(table).find(
    (s) => s.toString() === "Symbol(drizzle:Name)",
  );
  return sym ? ((table as unknown as Record<symbol, unknown>)[sym] as string) : "?";
};

/** Mock db with tx rollback simulation + optional execute() row injection (for
 *  claimNextRun's raw UPDATE...RETURNING). */
function makeDb(opts: { claimRow?: Record<string, unknown> | null } = {}) {
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  let nextId = 1;
  let corruptRelay = false;

  const ops: Record<string, unknown> = {
    // emit()'s idempotency lookup (when eventKey is set) calls
    // .select().from().where().limit() — return no existing row so the insert
    // path runs.
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: (table: object) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const tableName = tableNameOf(table);
          if (tableName === "relay_events" && corruptRelay) {
            throw new Error("relay insert exploded (simulated)");
          }
          inserts.push({ table: tableName, values });
          return [{ id: `mock-${tableName}-${nextId++}`, ...values }];
        },
      }),
    }),
    execute: async () => {
      // claimNextRun's UPDATE ... RETURNING * → return the configured claim row.
      return (opts.claimRow ? [opts.claimRow] : []) as unknown as never;
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = inserts.length;
      try {
        return await fn(ops);
      } catch (e) {
        inserts.length = snapshot;
        throw e;
      }
    },
  };

  return {
    db: ops as unknown as Parameters<typeof writeAudit>[0],
    inserts,
    setCorruptRelay: (v: boolean) => { corruptRelay = v; },
  };
}

async function main() {
  console.log("• writeAudit — mirrors to tool.result in same tx (conservative payload)");
  const { db: auditDb, inserts: auditInserts } = makeDb();
  await writeAudit(auditDb, {
    tenantId: "t1",
    runId: "r1",
    agentId: "a1",
    toolName: "Slack.postMessage",
    inputHash: "deadbeef",
    result: "ok",
  });
  assert(auditInserts.some((i) => i.table === "audit_log"), "audit_log row inserted");
  const relayRow = auditInserts.find((i) => i.table === "relay_events");
  assert(relayRow?.values.eventName === "tool.result", "relay_events row event_name=tool.result");
  assert(
    (relayRow?.values.payload as Record<string, unknown>)?.input_hash === "deadbeef",
    "payload carries input_hash (the conservative, hashed form)",
  );
  assert(
    !("input" in ((relayRow?.values.payload as Record<string, unknown>) ?? {})),
    "payload does NOT carry raw input (conservative per operator call)",
  );
  assert(
    (relayRow?.values.payload as Record<string, unknown>)?.tool_name === "Slack.postMessage",
    "payload carries tool_name",
  );
  assert(relayRow?.values.piiClass === undefined || relayRow?.values.piiClass === "none" ? true : relayRow?.values.piiClass === undefined, "pii_class default (none) — no client PII crosses in");

  console.log("• writeAudit — ATOMIC: relay failure rolls back the audit_log row");
  const corrupt = makeDb();
  corrupt.setCorruptRelay(true);
  await assertRejects(
    () =>
      writeAudit(corrupt.db, {
        tenantId: "t1",
        runId: "r1",
        agentId: "a1",
        toolName: "x",
        inputHash: "h",
        result: "ok",
      }),
    "relay insert exploded",
    "writeAudit re-throws emit failure",
  );
  assert(corrupt.inserts.length === 0, `audit_log row rolled back (got ${corrupt.inserts.length} inserts)`);

  console.log("• claimNextRun — emits run.started for the claimed run");
  const claimRow = {
    id: "run-7",
    tenant_id: "t1",
    agent_id: "a1",
    status: "running",
    trigger_source: "cron",
    scheduled_for: null,
    sdk_session_id: null,
  };
  const { db: claimDb, inserts: claimInserts } = makeDb({ claimRow });
  const claimed = await claimNextRun(claimDb, "a1", "t1", "runner-1");
  assert(claimed?.id === "run-7", "returns the claimed run");
  const startedEvt = claimInserts.find((i) => i.table === "relay_events");
  assert(startedEvt?.values.eventName === "run.started", "emits run.started");
  assert(startedEvt?.values.runId === "run-7", "run.started carries runId");
  assert(
    (startedEvt?.values.payload as Record<string, unknown>)?.trigger_source === "cron",
    "run.started payload carries trigger_source",
  );
  assert(
    startedEvt?.values.eventKey === "run.started:run-7",
    "run.started carries idempotency eventKey",
  );

  console.log("• claimNextRun — idle queue: no run, no event");
  const { db: idleDb, inserts: idleInserts } = makeDb({ claimRow: null });
  const idle = await claimNextRun(idleDb, "a1", "t1", "runner-1");
  assert(idle === null, "returns null when queue is empty");
  assert(idleInserts.length === 0, "no run.started emitted when nothing claimed");

  console.log("• claimNextRun — ATOMIC: relay failure rolls back the claim");
  const claimCorrupt = makeDb({ claimRow });
  claimCorrupt.setCorruptRelay(true);
  await assertRejects(
    () => claimNextRun(claimCorrupt.db, "a1", "t1", "runner-1"),
    "relay insert exploded",
    "claimNextRun re-throws emit failure (claim rolls back → run returns to queue)",
  );
  assert(claimCorrupt.inserts.length === 0, "no relay row persisted on rollback");

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
