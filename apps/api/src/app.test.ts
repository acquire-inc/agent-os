// In-process API integration test (no port). Hits the Hono app via app.request.
// Run: DATABASE_URL=... pnpm --filter @agent-os/api test
import { createApiKey, fixtureLlmFromJson } from "@agent-os/core";
import { schema } from "@agent-os/db";
import { eq } from "drizzle-orm";
import { AGENT_IDS, TENANT_IDS } from "@agent-os/shared";
import { app, db, setArchitectLlm } from "./index.js";

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

  console.log("\n[inngest mount (07-04)]");
  // The Inngest serve handler is mounted ABOVE the /api/* api-key middleware, so
  // it must respond WITHOUT a bearer key — Inngest authenticates via its own
  // signing key. We test the *bypass* by checking the response body shape:
  // the api-key middleware returns {"error":"unauthorized"}; Inngest's own
  // 401 (missing/invalid signature) has a different shape. Either is OK — we
  // just need to prove the api-key middleware didn't intercept first.
  {
    const res = await app.request("/api/inngest", { method: "GET" });
    const body = await res.text();
    assert(
      !body.includes('"error":"unauthorized"'),
      `GET /api/inngest is NOT blocked by the api-key middleware (status=${res.status}, body=${body.slice(0, 120)})`,
    );
  }

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

  console.log("\n[budget enforcement (Step 1b)]");
  // Insert a fresh scheduled run, claim it, post over-cap cost — server flips
  // it to 'failed' and writes both budget_cap and session_end events.
  const [overRun] = await db.insert(schema.runs).values({ tenantId: ACQU, agentId: ADOPS, status: "scheduled", triggerSource: "manual", scheduledFor: new Date() }).returning();
  await app.request(`/api/agents/${ADOPS}/next`, { headers: rh }); // claim
  const overRes = await app.request(`/api/runs/${overRun!.id}/status`, { method: "PUT", headers: rh, body: JSON.stringify({ status: "done", summary: "blew the cap", costUsd: 9999.99 }) });
  assert(overRes.status === 200, "over-budget status update accepted (200)");
  const overFinal = (await overRes.json()) as { run: { status: string; summary: string } };
  assert(overFinal.run.status === "failed", "server overrode status to 'failed' on over-budget");
  assert(/over budget/i.test(overFinal.run.summary), "summary annotated with 'over budget'");
  const overEvs = await db.select().from(schema.autonomyEvents).where(eq(schema.autonomyEvents.runId, overRun!.id));
  const kinds = new Set(overEvs.map((e) => e.kind));
  assert(kinds.has("budget_cap"), "budget_cap autonomy event written");
  assert(kinds.has("session_end"), "session_end autonomy event written");

  // Under-cap control: same cap, small cost → no override, no budget_cap event.
  const [underRun] = await db.insert(schema.runs).values({ tenantId: ACQU, agentId: ADOPS, status: "scheduled", triggerSource: "manual", scheduledFor: new Date() }).returning();
  await app.request(`/api/agents/${ADOPS}/next`, { headers: rh });
  const underRes = await app.request(`/api/runs/${underRun!.id}/status`, { method: "PUT", headers: rh, body: JSON.stringify({ status: "done", summary: "tiny cost", costUsd: 0.01 }) });
  const underFinal = (await underRes.json()) as { run: { status: string } };
  assert(underFinal.run.status === "done", "under-budget run stays 'done'");
  const underEvs = await db.select().from(schema.autonomyEvents).where(eq(schema.autonomyEvents.runId, underRun!.id));
  assert(underEvs.some((e) => e.kind === "session_end"), "under-budget done still records session_end");
  assert(!underEvs.some((e) => e.kind === "budget_cap"), "no spurious budget_cap on under-budget run");

  console.log("\n[autonomy events]");
  const ev = await app.request(`/api/runs/${runId}/autonomy-event`, { method: "POST", headers: rh, body: JSON.stringify({ kind: "allow", toolName: "close.update_lead", rationale: "in allow-list" }) });
  assert(ev.status === 201, "POST autonomy-event 'allow' (201)");
  const evBad = await app.request(`/api/runs/${runId}/autonomy-event`, { method: "POST", headers: rh, body: JSON.stringify({ kind: "what" }) });
  assert(evBad.status === 400, "invalid kind rejected (400)");
  const evCross = await app.request(`/api/runs/${otherRun!.id}/autonomy-event`, { method: "POST", headers: rh, body: JSON.stringify({ kind: "allow" }) });
  assert(evCross.status === 404, "cross-tenant autonomy-event rejected (404)");

  console.log("\n[approval bridge end-to-end (1c)]");
  // Simulate what the runner's PreToolUse hook does on an irreversible call.
  const [bridgeRun] = await db.insert(schema.runs).values({ tenantId: ACQU, agentId: ADOPS, status: "running", triggerSource: "manual", scheduledFor: new Date() }).returning();
  const raise = await app.request(`/api/runs/${bridgeRun!.id}/approvals`, {
    method: "POST", headers: rh,
    body: JSON.stringify({
      context: "Ad-Ops wants to call close.update_lead",
      proposedAction: "close.update_lead",
      options: [{ key: "1A", label: "Allow once" }, { key: "1B", label: "Always allow this run" }, { key: "none", label: "Deny" }],
      sdkSessionId: "sess_bridge_01",
    }),
  });
  assert(raise.status === 201, "raise approval (201)");
  const raised = (await raise.json()) as { approval: { id: string } };
  // Record the 'propose' autonomy event (what the runner's hook does in parallel).
  const prop = await app.request(`/api/runs/${bridgeRun!.id}/autonomy-event`, {
    method: "POST", headers: rh,
    body: JSON.stringify({ kind: "propose", toolName: "close.update_lead", rationale: "irreversible under propose" }),
  });
  assert(prop.status === 201, "record 'propose' autonomy event (201)");
  // Run is now waiting + sdkSessionId persisted for resume.
  const [postRaise] = await db.select().from(schema.runs).where(eq(schema.runs.id, bridgeRun!.id));
  assert(postRaise?.status === "waiting", "run flips to 'waiting'");
  assert(postRaise?.sdkSessionId === "sess_bridge_01", "sdkSessionId persisted for resume");
  // Decide and verify the run is now ready for resume.
  const decide = await app.request(`/api/approvals/${raised.approval.id}/decide`, {
    method: "POST", headers: rh, body: JSON.stringify({ optionKey: "1A" }),
  });
  assert(decide.status === 200, "decide approval (200)");
  const [postDecide] = await db.select().from(schema.runs).where(eq(schema.runs.id, bridgeRun!.id));
  assert(postDecide?.status === "pending", "decided run → 'pending' (claimable by runner)");

  console.log("\n[architect (1d — plain-English → seeded agents)]");
  // 501 path when no LLM is configured.
  setArchitectLlm(null);
  const unconfigured = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: ah, body: JSON.stringify({ prompt: "build me a marketing team" }),
  });
  assert(unconfigured.status === 501, "501 when OPENROUTER_API_KEY isn't set");

  // Inject a fixture LLM that emits a valid 2-agent blueprint.
  setArchitectLlm(fixtureLlmFromJson({
    teamName: "Test Marketing Pair",
    rationale: "Two-agent loop: scout the market, post to Slack.",
    agents: [
      {
        key: "apitest-meta-scout",
        name: "Apitest Meta Scout",
        role: "Scout competitor ads.",
        systemPrompt: "You are the Apitest Meta Scout. EVERY MORNING (07:00): ... RULES: ...",
        model: "nousresearch/hermes-4-70b",
        thinkingLevel: "low",
        autonomy: "propose",
        knowledgeScope: { folders: ["ad-playbooks"], tags: [] },
        budgetCapUsd: "0.30",
        cron: { schedule: "0 7 * * *", jobName: "Apitest morning scout" },
        skillKeys: ["competitor-ad-teardown"],
        mcpNames: ["Pipeboard × Meta"],
      },
      {
        key: "apitest-slack-poster",
        name: "Apitest Slack Poster",
        role: "Post scout findings to Slack.",
        systemPrompt: "You are the Apitest Slack Poster. EVERY MORNING (07:15): ... RULES: ...",
        model: "nousresearch/hermes-4-70b",
        thinkingLevel: "low",
        autonomy: "propose",
        knowledgeScope: { folders: [], tags: [] },
        budgetCapUsd: "0.10",
        cron: { schedule: "15 7 * * *", jobName: "Apitest scout post" },
        skillKeys: [],
        mcpNames: ["Slack"],
      },
    ],
    proposedSkills: [],
    proposedMcps: [],
  }, { model: "fixture/hermes-4-405b", costUsd: 0.01 }));

  // Non-admin → 403
  const noAdminPropose = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: rh, body: JSON.stringify({ prompt: "anything" }),
  });
  assert(noAdminPropose.status === 403, "runner key cannot propose blueprints (403)");

  // Missing prompt → 400
  const noPrompt = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: ah, body: JSON.stringify({}),
  });
  assert(noPrompt.status === 400, "400 when prompt missing");

  // Happy path → 201 with blueprint
  const proposeRes = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: ah, body: JSON.stringify({ prompt: "create my marketing team for Meta ads" }),
  });
  assert(proposeRes.status === 201, "propose returns 201");
  const proposed = (await proposeRes.json()) as { blueprint: { id: string; teamName: string; agents: { key: string; enabled: boolean; autonomy: string }[]; warnings: string[]; status: string } };
  assert(proposed.blueprint.teamName === "Test Marketing Pair", "blueprint persisted with teamName");
  assert(proposed.blueprint.agents.length === 2, "blueprint has 2 agents");
  assert(proposed.blueprint.agents.every((a) => a.autonomy === "propose"), "all blueprint agents autonomy=propose");
  assert(proposed.blueprint.agents.every((a) => a.enabled === false), "all blueprint agents enabled=false");
  assert(proposed.blueprint.status === "proposed", "blueprint status=proposed");

  // GET single blueprint
  const getOne = await app.request(`/api/admin/architect/blueprints/${proposed.blueprint.id}`, { headers: ah });
  assert(getOne.status === 200, "GET blueprint by id (200)");
  // 404 unknown id
  const notFound = await app.request("/api/admin/architect/blueprints/00000000-0000-0000-0000-000000000000", { headers: ah });
  assert(notFound.status === 404, "unknown blueprint id → 404");
  // GET list
  const listRes = await app.request("/api/admin/architect/blueprints?limit=5", { headers: ah });
  const list = (await listRes.json()) as { blueprints: { id: string }[] };
  assert(list.blueprints.length >= 1, "list returns at least the new blueprint");

  // Seed it.
  const seedRes = await app.request("/api/admin/architect/seed", {
    method: "POST", headers: ah, body: JSON.stringify({ blueprintId: proposed.blueprint.id }),
  });
  assert(seedRes.status === 201, "seed returns 201");
  const seeded = (await seedRes.json()) as { seeded: { key: string; autonomy: string; enabled: boolean; agentId: string }[] };
  assert(seeded.seeded.length === 2, "2 agents seeded");
  assert(seeded.seeded.every((s) => s.autonomy === "propose" && s.enabled === false), "all seeded autonomy=propose, enabled=false");

  // Idempotent re-seed returns the same agents (status=seeded short-circuit).
  const reSeed = await app.request("/api/admin/architect/seed", {
    method: "POST", headers: ah, body: JSON.stringify({ blueprintId: proposed.blueprint.id }),
  });
  assert(reSeed.status === 201, "re-seed idempotent (201)");

  // ---- remix flow ----
  // 400 when mode=remix without baseAgentKey
  const noBase = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: ah, body: JSON.stringify({ prompt: "make it weekly", mode: "remix" }),
  });
  assert(noBase.status === 400, "remix without baseAgentKey → 400");

  // Inject a fixture LLM that emits a single-agent remix re-using the apitest-meta-scout key.
  setArchitectLlm(fixtureLlmFromJson({
    teamName: "Remix: weekly scout",
    rationale: "Switch to weekly cadence per operator instruction.",
    agents: [{
      key: "apitest-meta-scout",
      name: "Apitest Meta Scout (Weekly)",
      role: "Weekly competitor scan.",
      systemPrompt: "You are the Apitest Meta Scout. EVERY MONDAY (07:00): ... RULES: ...",
      model: "nousresearch/hermes-4-70b",
      thinkingLevel: "low",
      autonomy: "propose",
      knowledgeScope: { folders: ["ad-playbooks"], tags: [] },
      budgetCapUsd: "0.30",
      cron: { schedule: "0 7 * * 1", jobName: "Weekly scout" },
      skillKeys: [],
      mcpNames: ["Pipeboard × Meta"],
    }],
    proposedSkills: [],
    proposedMcps: [],
  }, { model: "fixture/hermes-4-405b", costUsd: 0.005 }));

  const remixRes = await app.request("/api/admin/architect/propose", {
    method: "POST", headers: ah,
    body: JSON.stringify({ prompt: "switch to weekly on Mondays at 07:00", mode: "remix", baseAgentKey: "apitest-meta-scout" }),
  });
  assert(remixRes.status === 201, "remix propose returns 201");
  const remixBP = (await remixRes.json()) as { blueprint: { id: string; agents: { key: string; cron?: { schedule: string } | null }[] } };
  assert(remixBP.blueprint.agents.length === 1, "remix returns single-agent team");
  assert(remixBP.blueprint.agents[0]!.key === "apitest-meta-scout", "remix preserves the base key");
  assert(remixBP.blueprint.agents[0]!.cron?.schedule === "0 7 * * 1", "remix carries new cron");

  // Seed it — upsertAgent(tenant, key) should hit the SAME row.
  const baseAgentId = seeded.seeded.find((s) => s.key === "apitest-meta-scout")!.agentId;
  const remixSeedRes = await app.request("/api/admin/architect/seed", {
    method: "POST", headers: ah, body: JSON.stringify({ blueprintId: remixBP.blueprint.id }),
  });
  assert(remixSeedRes.status === 201, "remix seed returns 201");
  const remixSeeded = (await remixSeedRes.json()) as { seeded: { key: string; agentId: string }[] };
  assert(remixSeeded.seeded[0]!.agentId === baseAgentId, "remix re-uses the same agent row (upsert by key)");

  // Cross-tenant blueprint fetch returns 404.
  const otherAdmin = (await createApiKey(db, { tenantId: TENANT_IDS.cliently, kind: "admin", name: "apitest-admin-other" })).raw;
  const crossGet = await app.request(`/api/admin/architect/blueprints/${proposed.blueprint.id}`, {
    headers: { Authorization: `Bearer ${otherAdmin}` },
  });
  assert(crossGet.status === 404, "blueprint scoped to its tenant (cross-tenant 404)");

  // Clean up the seeded agents so re-runs of the test stay green.
  for (const s of seeded.seeded) {
    await db.delete(schema.agents).where(eq(schema.agents.id, s.agentId));
  }
  // And drop the blueprints we created.
  await db.delete(schema.architectBlueprints).where(eq(schema.architectBlueprints.tenantId, ACQU));

  console.log("\n[cost + knowledge]");
  const cost = (await (await app.request("/api/cost", { headers: rh })).json()) as { summary: { total: number }; budget: { level: string } };
  assert(typeof cost.summary.total === "number" && ["ok", "warn", "over"].includes(cost.budget.level), "GET /api/cost returns summary + budget");
  const search = await app.request("/api/knowledge/search", { method: "POST", headers: rh, body: JSON.stringify({ query: "test" }) });
  assert(search.status === 200, "POST /api/knowledge/search responds");

  console.log("\n[model routing audit (Phase 60)]");
  // Seed two model.routed events directly so the endpoint has something to return.
  // One audit-only (applied=false), one realized (applied=true). Tenant-scoped.
  await db.insert(schema.relayEvents).values([
    {
      tenantId: ACQU,
      agentId: ADOPS,
      eventName: "model.routed",
      actor: "system",
      occurredAt: new Date(Date.now() - 60_000),
      payload: { agent_model: "nousresearch/hermes-4-70b", applied: false, recommended_slug: "nousresearch/hermes-4-405b", source: "tier_fork", reason: "task needed reasoning" },
    },
    {
      tenantId: ACQU,
      agentId: ADOPS,
      eventName: "model.routed",
      actor: "system",
      occurredAt: new Date(),
      payload: { agent_model: "nousresearch/hermes-4-70b", applied: true, model_ran: "nousresearch/hermes-4-405b", source: "sub_agent_dispatch", task_label: "synthesize", cost_usd: 0.04 },
    },
  ]);
  // Cross-tenant noise: a model.routed event under a different tenant must NOT leak in.
  await db.insert(schema.relayEvents).values({
    tenantId: TENANT_IDS.cliently,
    agentId: CLIENTLY_AGENT,
    eventName: "model.routed",
    actor: "system",
    occurredAt: new Date(),
    payload: { agent_model: "x", applied: false, source: "tier_fork" },
  });

  const mrAll = await (await app.request("/api/admin/model-routing/recent", { headers: ah })).json() as { events: Array<{ id: string; agentId: string | null; payload: Record<string, unknown> }> };
  assert(mrAll.events.length >= 2, `model-routing/recent returns rows (got ${mrAll.events.length})`);
  assert(mrAll.events.every((e) => e.agentId === null || e.agentId === ADOPS), "model-routing/recent is tenant-scoped (no Cliently leak)");

  const mrApplied = await (await app.request("/api/admin/model-routing/recent?applied=true", { headers: ah })).json() as { events: Array<{ payload: Record<string, unknown> }> };
  assert(mrApplied.events.length >= 1 && mrApplied.events.every((e) => e.payload.applied === true), "applied=true filter narrows to realized forks");

  const mrLimited = await (await app.request("/api/admin/model-routing/recent?limit=1", { headers: ah })).json() as { events: unknown[] };
  assert(mrLimited.events.length === 1, "limit param honored");

  const mrUnauth = await app.request("/api/admin/model-routing/recent", { headers: rh });
  assert(mrUnauth.status === 403, `runner key rejected on admin endpoint (got ${mrUnauth.status})`);

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
