import { serve } from "@hono/node-server";
import { createDb, schema } from "@agent-os/db";
import {
  appendActivity,
  buildBundle,
  claimNextRun,
  createApiKey,
  peekNextRun,
  raiseApproval,
  retryRun,
  setRunStatus,
  verifyApiKey,
  type ApiKeyContext,
} from "@agent-os/core";
import { RUN_STATUSES } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { adminGuide, apiGuide } from "./guide.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

const db = createDb(DATABASE_URL);

type Vars = { auth: ApiKeyContext };
const app = new Hono<{ Variables: Vars }>();

// --- Public ---
app.get("/health", (c) => c.json({ ok: true }));
app.get("/api/guide", (c) => c.json(apiGuide));
app.get("/api/admin-guide", (c) => c.json(adminGuide));

// --- API key auth for everything else under /api ---
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/guide" || c.req.path === "/api/admin-guide") return next();
  const header = c.req.header("authorization");
  const raw = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : c.req.header("x-api-key");
  const auth = await verifyApiKey(db, raw ?? "");
  if (!auth) return c.json({ error: "unauthorized" }, 401);
  c.set("auth", auth);
  return next();
});

const requireAdmin = async (c: { get: (k: "auth") => ApiKeyContext; json: (b: unknown, s?: number) => Response }, next: () => Promise<void>) => {
  if (c.get("auth").kind !== "admin") return c.json({ error: "admin key required" }, 403);
  return next();
};

/** Load a run and assert it belongs to the caller's tenant. */
async function ownedRun(tenantId: string, runId: string) {
  const [run] = await db.select().from(schema.runs).where(and(eq(schema.runs.id, runId), eq(schema.runs.tenantId, tenantId))).limit(1);
  return run ?? null;
}

// ============================ Agent API ============================
app.get("/api/agents/:id/next", async (c) => {
  const { tenantId } = c.get("auth");
  const agentId = c.req.param("id");
  const peek = c.req.query("peek") === "true";

  const [agent] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, agentId), eq(schema.agents.tenantId, tenantId))).limit(1);
  if (!agent) return c.json({ error: "agent not found" }, 404);

  if (peek) {
    const run = await peekNextRun(db, agentId, tenantId);
    return c.json({ hasWork: Boolean(run), run });
  }

  const claimed = await claimNextRun(db, agentId, tenantId, c.req.header("x-runner-id") ?? "runner");
  if (!claimed) return c.json({ hasWork: false }, 200);
  const bundle = await buildBundle(db, claimed.id, PUBLIC_URL);
  return c.json({ hasWork: true, run: claimed, bundle });
});

app.put("/api/runs/:id/status", async (c) => {
  const { tenantId } = c.get("auth");
  const run = await ownedRun(tenantId, c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!RUN_STATUSES.includes(body.status)) return c.json({ error: "invalid status", valid: RUN_STATUSES }, 400);
  const updated = await setRunStatus(db, run.id, {
    status: body.status,
    summary: body.summary,
    tokensIn: body.tokensIn,
    tokensOut: body.tokensOut,
    costUsd: body.costUsd,
    sdkSessionId: body.sdkSessionId,
  });
  return c.json({ run: updated });
});

app.post("/api/runs/:id/activity", async (c) => {
  const { tenantId } = c.get("auth");
  const run = await ownedRun(tenantId, c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.kind || !body.message) return c.json({ error: "kind and message required" }, 400);
  const row = await appendActivity(db, run.id, tenantId, String(body.kind), String(body.message));
  return c.json({ activity: row }, 201);
});

app.post("/api/runs/:id/retry", async (c) => {
  const { tenantId } = c.get("auth");
  const run = await ownedRun(tenantId, c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const row = await retryRun(db, run.id);
  return c.json({ run: row }, 201);
});

app.post("/api/runs/:id/approvals", async (c) => {
  const { tenantId } = c.get("auth");
  const run = await ownedRun(tenantId, c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.context || !body.proposedAction || !Array.isArray(body.options)) {
    return c.json({ error: "context, proposedAction, options[] required" }, 400);
  }
  const approval = await raiseApproval(db, {
    runId: run.id,
    tenantId,
    agentId: run.agentId,
    context: String(body.context),
    proposedAction: String(body.proposedAction),
    options: body.options,
  });
  return c.json({ approval }, 201);
});

app.post("/api/docs", async (c) => {
  const { tenantId } = c.get("auth");
  const body = await c.req.json().catch(() => ({}));
  if (!body.name) return c.json({ error: "name required" }, 400);
  const [doc] = await db.insert(schema.documents).values({
    tenantId,
    projectId: body.projectId ?? null,
    name: String(body.name),
    type: body.type ?? "markdown",
    source: body.source ?? "agent-generated",
  }).returning();
  return c.json({ document: doc }, 201);
});

app.put("/api/docs/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name) patch.name = body.name;
  if (typeof body.vectorIndexed === "boolean") patch.vectorIndexed = body.vectorIndexed;
  const [doc] = await db.update(schema.documents).set(patch).where(and(eq(schema.documents.id, id), eq(schema.documents.tenantId, tenantId))).returning();
  if (!doc) return c.json({ error: "document not found" }, 404);
  return c.json({ document: doc });
});

// ============================ Admin API ============================
app.post("/api/admin/agents", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.key || !b.name) return c.json({ error: "key and name required" }, 400);
  const [agent] = await db.insert(schema.agents).values({
    tenantId, key: b.key, name: b.name, persona: b.persona ?? null,
    backend: b.backend ?? "claude-agent-sdk", model: b.model ?? "claude-sonnet-4-6", autonomy: b.autonomy ?? "propose",
  }).returning();
  return c.json({ agent }, 201);
});

app.post("/api/admin/jobs", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.agentId || !b.name || !b.scheduleCron) return c.json({ error: "agentId, name, scheduleCron required" }, 400);
  const [job] = await db.insert(schema.jobs).values({
    tenantId, agentId: b.agentId, name: b.name, scheduleCron: b.scheduleCron, instructions: b.instructions ?? "",
  }).returning();
  return c.json({ job }, 201);
});

app.post("/api/admin/skills", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.key || !b.name) return c.json({ error: "key and name required" }, 400);
  const [skill] = await db.insert(schema.skills).values({
    tenantId, key: b.key, name: b.name, description: b.description ?? "", source: b.source ?? "custom", repoPath: b.repoPath ?? null,
  }).returning();
  return c.json({ skill }, 201);
});

app.post("/api/admin/mcps", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.name) return c.json({ error: "name required" }, 400);
  const [mcp] = await db.insert(schema.mcps).values({
    tenantId, name: b.name, transport: b.transport ?? "http", endpoint: b.endpoint ?? null, authType: b.authType ?? "none",
  }).returning();
  return c.json({ mcp }, 201);
});

app.post("/api/admin/keys", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.kind || !b.name) return c.json({ error: "kind and name required" }, 400);
  const { raw, row } = await createApiKey(db, { tenantId, kind: b.kind, name: b.name });
  return c.json({ key: raw, id: row?.id, note: "Store this key now — it is shown only once." }, 201);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Agent OS API listening on http://localhost:${info.port}`);
});

export { app };
