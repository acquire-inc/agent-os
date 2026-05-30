// Integration test for the domain core against a real Postgres.
// Run: DATABASE_URL=... pnpm --filter @agent-os/core test
import { createDb, schema } from "@agent-os/db";
import { AGENT_IDS, TENANT_IDS } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import {
  appendActivity,
  buildBundle,
  claimNextRun,
  createApiKey,
  evaluateDueJobs,
  hashApiKey,
  hashEmbedder,
  peekNextRun,
  raiseApproval,
  recordAutonomyEvent,
  resolveApproval,
  retrieve,
  setRunStatus,
  verifyApiKey,
} from "./index.js";

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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDb(url);
  const tenantId = TENANT_IDS.acqu;
  const agentId = AGENT_IDS.adOps;

  console.log("\n[auth]");
  const { raw } = await createApiKey(db, { tenantId, kind: "runner", name: "test-runner" });
  const ctx = await verifyApiKey(db, raw);
  assert(ctx?.tenantId === tenantId && ctx?.kind === "runner", "createApiKey + verifyApiKey round-trips");
  assert((await verifyApiKey(db, "bogus")) === null, "bogus key rejected");
  assert(hashApiKey("x") === hashApiKey("x"), "hashApiKey is deterministic");

  console.log("\n[scheduler]");
  const first = await evaluateDueJobs(db);
  assert(Array.isArray(first), `evaluateDueJobs materialized ${first.length} run(s)`);
  const second = await evaluateDueJobs(db);
  assert(second.length === 0, "evaluateDueJobs is idempotent (no duplicate runs on second pass)");

  console.log("\n[claim]");
  // Insert a deterministic scheduled run for ad-ops to claim.
  const [scheduled] = await db
    .insert(schema.runs)
    .values({ tenantId, agentId, status: "scheduled", triggerSource: "manual", scheduledFor: new Date() })
    .returning();
  const peek = await peekNextRun(db, agentId, tenantId);
  assert(peek !== null, "peekNextRun finds work without claiming");
  assert(peek?.status === "scheduled", "peeked run is still 'scheduled' (not claimed)");

  const claimed = await claimNextRun(db, agentId, tenantId, "runner-test-1");
  assert(claimed !== null, "claimNextRun returns a run");
  assert(claimed?.status === "running", "claimed run is now 'running'");
  assert(claimed?.claimedBy === "runner-test-1", "claimed run records the runner");

  // A second claim should not re-claim the same row.
  const reclaim = await claimNextRun(db, agentId, tenantId, "runner-test-2");
  assert(reclaim?.id !== claimed?.id, "second claim does not return the same already-claimed run");

  console.log("\n[bundle]");
  const runId = claimed!.id;
  const bundle = await buildBundle(db, runId, "https://api.example.com");
  assert(bundle?.agent.key === "ad-ops", "bundle resolves the agent");
  assert(bundle!.skills.length >= 1, `bundle includes attached skills (${bundle!.skills.length})`);
  assert(bundle!.mcpServers.length >= 1, `bundle includes MCP servers (${bundle!.mcpServers.length})`);
  assert(bundle!.api.statusUrl.endsWith(`/api/runs/${runId}/status`), "bundle carries callback URLs");
  assert(bundle!.api.validStatuses.includes("waiting"), "bundle lists valid statuses");
  assert(Array.isArray(bundle!.knowledge) && bundle!.knowledge.length === 0, "bundle knowledge empty without a retriever");
  const bundleK = await buildBundle(db, runId, "https://api.example.com", {
    retrieveKnowledge: async () => [{ chunk: "Northwind is at churn risk.", source: "acqu/memory" }],
  });
  assert(bundleK!.knowledge.length === 1 && bundleK!.knowledge[0]!.source === "acqu/memory", "bundle injects retrieved knowledge when a retriever is supplied");

  console.log("\n[lifecycle]");
  await appendActivity(db, runId, tenantId, "tool", "close.get_metrics()");
  const acts = await db.select().from(schema.runActivity).where(eq(schema.runActivity.runId, runId));
  assert(acts.length >= 1, "appendActivity writes an activity row");

  const done = await setRunStatus(db, runId, { status: "done", summary: "Pulled metrics; all nominal.", costUsd: 0.12, tokensIn: 4000, tokensOut: 300 });
  assert(done?.status === "done", "setRunStatus transitions to done");
  assert(done?.endedAt !== null, "terminal status stamps ended_at");
  const memDocs = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.source, "agent-generated"));
  assert(memDocs.some((d) => d.name.startsWith("run-summary_")), "done run writes a memory document (write-back)");

  console.log("\n[approvals]");
  const [waitingRun] = await db
    .insert(schema.runs)
    .values({ tenantId, agentId, status: "running", triggerSource: "manual", scheduledFor: new Date() })
    .returning();
  const approval = await raiseApproval(db, {
    runId: waitingRun!.id,
    tenantId,
    agentId,
    context: "CPA rose 28%.",
    proposedAction: "Shift $200/day.",
    options: [
      { key: "1A", label: "Do it" },
      { key: "none", label: "Hold" },
    ],
  });
  const [afterRaise] = await db.select().from(schema.runs).where(eq(schema.runs.id, waitingRun!.id));
  assert(afterRaise?.status === "waiting", "raiseApproval flips run to 'waiting'");
  await resolveApproval(db, approval!.id, "1A", null);
  const [afterResolve] = await db.select().from(schema.runs).where(eq(schema.runs.id, waitingRun!.id));
  assert(afterResolve?.status === "pending", "resolveApproval flips run to 'pending' for resume");

  console.log("\n[memory write-back is indexed + searchable]");
  const embedder = hashEmbedder();
  const [memRun] = await db
    .insert(schema.runs)
    .values({ tenantId, agentId, status: "running", triggerSource: "manual", scheduledFor: new Date() })
    .returning();
  await setRunStatus(db, memRun!.id, { status: "done", summary: "Northwind renewal churn risk: usage decline and unanswered emails; proposed a save play." }, embedder);
  const memHits = await retrieve(db, embedder, { tenantId, query: "Northwind renewal churn risk save play", namespaces: [`tenant/${tenantId}/memory`], limit: 3 });
  assert(memHits.length >= 1, "completed run's summary is vector-indexed into memory and retrievable");

  console.log("\n[session_end on terminal]");
  // The done run above must have produced exactly one session_end event.
  const seEvs = await db
    .select()
    .from(schema.autonomyEvents)
    .where(and(eq(schema.autonomyEvents.runId, memRun!.id), eq(schema.autonomyEvents.kind, "session_end")));
  assert(seEvs.length === 1, "setRunStatus records exactly one session_end on terminal");
  assert(seEvs[0]?.rationale === "done", "session_end rationale carries the terminal status");

  console.log("\n[autonomy events]");
  const allowEv = await recordAutonomyEvent(db, { tenantId, runId: memRun!.id, agentId, kind: "allow", toolName: "close.update_lead" });
  assert(allowEv?.kind === "allow", "recordAutonomyEvent writes an 'allow' event");
  const denyEv = await recordAutonomyEvent(db, { tenantId, runId: memRun!.id, agentId, kind: "deny", toolName: "close.delete", rationale: "irreversible under propose" });
  assert(denyEv?.kind === "deny" && denyEv.rationale === "irreversible under propose", "records 'deny' with rationale");
  const evs = await db.select().from(schema.autonomyEvents).where(eq(schema.autonomyEvents.runId, memRun!.id));
  assert(evs.length >= 2, "events queryable by run");

  console.log("\n[resume: pending runs are claimable]");
  // The decided run (now pending) must be re-claimable by the runner, else it strands.
  const resumed = await claimNextRun(db, agentId, tenantId, "runner-resume");
  assert(resumed?.id === waitingRun!.id, "claimNextRun resumes the pending run (prioritized over scheduled)");
  assert(resumed?.status === "running", "resumed run transitions back to running");

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
