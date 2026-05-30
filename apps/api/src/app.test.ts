// In-process API integration test (no port). Hits the Hono app via app.request.
// Run: DATABASE_URL=... pnpm --filter @agent-os/api test
import { createApiKey } from "@agent-os/core";
import { schema } from "@agent-os/db";
import { AGENT_IDS, TENANT_IDS } from "@agent-os/shared";
import { app, db } from "./index.js";

let passed = 0,
  failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) (passed++, console.log(`  ✓ ${msg}`));
  else (failed++, console.error(`  ✗ ${msg}`));
}

const ACQU = TENANT_IDS.acqu;
const ADOPS = AGENT_IDS.adOps;
const CLIENTLY_AGENT = AGENT_IDS.dev;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const runner = (await createApiKey(db, { tenantId: ACQU, kind: "runner", name: "apitest-runner" })).raw;
  const admin = (await createApiKey(db, { tenantId: ACQU, kind: "admin", name: "apitest-admin" })).raw;
  const rh = { Authorization: `Bearer ${runner}`, "content-type": "application/json" };
  const ah = { Authorization: `Bearer ${admin}`, "content-type": "application/json" };

  console.log("\n[public + auth]");
  assert((await app.request("/health")).status === 200, "GET /health is public");
  assert((await app.request("/api/guide")).status === 200, "GET /api/guide is public");
  assert((await app.request(`/api/agents/${ADOPS}/next`)).status === 401, "agent API rejects missing key (401)");
  assert((await app.request(`/api/agents/${ADOPS}/next`, { headers: { Authorization: "Bearer nope" } })).status === 401, "rejects bogus key");

  console.log("\n[claim + bundle + status]");
  const [run] = await db.insert(schema.runs).values({ tenantId: ACQU, agentId: ADOPS, status: "scheduled", triggerSource: "manual", scheduledFor: new Date() }).returning();
  const nextRes = await app.request(`/api/agents/${ADOPS}/next`, { headers: rh });
  const next = (await nextRes.json()) as { hasWork: boolean; run?: { id: string }; bundle?: { agent: { key: string }; api: { statusUrl: string } } };
  assert(next.hasWork && next.bundle?.agent.key === "ad-ops", "claim returns a bundle for the agent");
  const runId = next.run!.id;
  const statusRes = await app.request(`/api/runs/${runId}/status`, { method: "PUT", headers: rh, body: JSON.stringify({ status: "done", summary: "ok", costUsd: 0.05 }) });
  assert(statusRes.status === 200, "PUT status done succeeds");
  const badStatus = await app.request(`/api/runs/${runId}/status`, { method: "PUT", headers: rh, body: JSON.stringify({ status: "bogus" }) });
  assert(badStatus.status === 400, "invalid status rejected (400)");
  void run;

  console.log("\n[multi-tenant isolation]");
  // Another tenant's run id must 404 (scoped by tenant).
  const [otherRun] = await db.insert(schema.runs).values({ tenantId: TENANT_IDS.cliently, agentId: CLIENTLY_AGENT, status: "scheduled", triggerSource: "manual", scheduledFor: new Date() }).returning();
  const cross = await app.request(`/api/runs/${otherRun!.id}/status`, { method: "PUT", headers: rh, body: JSON.stringify({ status: "done" }) });
  assert(cross.status === 404, "cannot update another tenant's run (404)");
  const crossDoc = await app.request("/api/docs", { method: "POST", headers: rh, body: JSON.stringify({ name: "x", projectId: "30000000-0000-0000-0000-000000000005" }) });
  assert(crossDoc.status === 404, "cannot attach a doc to another tenant's project (404)");
  const crossJob = await app.request("/api/admin/jobs", { method: "POST", headers: ah, body: JSON.stringify({ agentId: CLIENTLY_AGENT, name: "x", scheduleCron: "0 9 * * *" }) });
  assert(crossJob.status === 404, "admin cannot create a job for another tenant's agent (404)");

  console.log("\n[admin gating]");
  assert((await app.request("/api/admin/agents", { method: "POST", headers: rh, body: JSON.stringify({ key: "x", name: "X" }) })).status === 403, "runner key cannot use admin API (403)");
  const okJob = await app.request("/api/admin/jobs", { method: "POST", headers: ah, body: JSON.stringify({ agentId: ADOPS, name: "apitest job", scheduleCron: "0 9 * * *" }) });
  assert(okJob.status === 201, "admin creates a job for its own agent (201)");

  console.log("\n[autonomy events]");
  const ev = await app.request(`/api/runs/${runId}/autonomy-event`, { method: "POST", headers: rh, body: JSON.stringify({ kind: "allow", toolName: "close.update_lead", rationale: "in allow-list" }) });
  assert(ev.status === 201, "POST autonomy-event 'allow' (201)");
  const evBad = await app.request(`/api/runs/${runId}/autonomy-event`, { method: "POST", headers: rh, body: JSON.stringify({ kind: "what" }) });
  assert(evBad.status === 400, "invalid kind rejected (400)");
  const evCross = await app.request(`/api/runs/${otherRun!.id}/autonomy-event`, { method: "POST", headers: rh, body: JSON.stringify({ kind: "allow" }) });
  assert(evCross.status === 404, "cross-tenant autonomy-event rejected (404)");

  console.log("\n[cost + knowledge]");
  const cost = (await (await app.request("/api/cost", { headers: rh })).json()) as { summary: { total: number }; budget: { level: string } };
  assert(typeof cost.summary.total === "number" && ["ok", "warn", "over"].includes(cost.budget.level), "GET /api/cost returns summary + budget");
  const search = await app.request("/api/knowledge/search", { method: "POST", headers: rh, body: JSON.stringify({ query: "test" }) });
  assert(search.status === 200, "POST /api/knowledge/search responds");

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
