import { serve } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";
import { inngest, runScheduledAgent } from "@agent-os/inngest";
import { createDb, schema } from "@agent-os/db";
import {
  ArchitectError,
  AUTONOMY_EVENT_KINDS,
  appendActivity,
  buildBundle,
  checkBudget,
  claimNextRun,
  costSummary,
  createApiKey,
  diskSkillSource,
  hashEmbedder,
  indexDocument,
  listBlueprints,
  loadBlueprint,
  openrouterLlm,
  peekNextRun,
  proposeBlueprint,
  provisionClientTenant,
  recordAutonomyEvent,
  raiseApproval,
  resolveApproval,
  retrieve,
  retryRun,
  seedFromBlueprint,
  sendApprovalNotification,
  setRunStatus,
  verifyApiKey,
  writeAudit,
  type ApiKeyContext,
  type LlmClient,
} from "@agent-os/core";
import { RUN_STATUSES } from "@agent-os/shared";
import { decryptEnvValue, loadVaultKey, makeBundleTokenResolver, storeCredential } from "@agent-os/vault";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { pathToFileURL } from "node:url";
import { adminGuide, apiGuide } from "./guide.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

const db = createDb(DATABASE_URL);

// Vault key is optional: with it, /next injects real short-TTL tokens; without
// it, the Bundle falls back to vaultRef placeholders.
let vaultKey: Buffer | null = null;
try {
  vaultKey = loadVaultKey();
  console.log("Vault key loaded — bundles inject live MCP tokens.");
} catch {
  console.warn("AOS_VAULT_KEY not set — MCP credentials in the Bundle are placeholders.");
}
const tokenResolver = vaultKey ? makeBundleTokenResolver(db, vaultKey) : undefined;

// Embedder for knowledge indexing/retrieval. hashEmbedder needs no API key;
// swap for a Voyage/OpenAI embedder in production.
const embedder = hashEmbedder();

// Architect LLM — optional. Without OPENROUTER_API_KEY the /architect/propose
// endpoint returns 501; everything else works. The `let` + setter pattern lets
// tests inject a fixture LLM via setArchitectLlm() without touching env.
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
let architectLlm: LlmClient | null = OPENROUTER_KEY
  ? openrouterLlm({ apiKey: OPENROUTER_KEY, model: process.env.ARCHITECT_MODEL ?? "nousresearch/hermes-4-405b" })
  : null;
export function setArchitectLlm(client: LlmClient | null) {
  architectLlm = client;
}
if (!architectLlm) {
  console.warn("OPENROUTER_API_KEY not set — /api/admin/architect/propose returns 501.");
}
// SKILL.md files live at {repoRoot}/external/acqu-skills/<key>/. From this
// process's cwd (the api package), that's two levels up.
const architectSkillSource = diskSkillSource(process.env.REPO_ROOT ?? process.cwd());

type Vars = { auth: ApiKeyContext };
const app = new Hono<{ Variables: Vars }>();

// --- Public ---
app.get("/health", (c) => c.json({ ok: true }));
app.get("/api/guide", (c) => c.json(apiGuide));
app.get("/api/admin-guide", (c) => c.json(adminGuide));

// --- Inngest webhook (Plan 07-04) ---
// Mounted BEFORE the /api/* api-key middleware: Inngest authenticates inbound
// calls with INNGEST_SIGNING_KEY via its own serve handler, not the project
// bearer key, so this route must not pass through verifyApiKey.
app.on(["GET", "POST", "PUT"], "/api/inngest", inngestServe({ client: inngest, functions: [runScheduledAgent] }));

// --- API key auth for everything else under /api ---
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/guide" || c.req.path === "/api/admin-guide" || c.req.path === "/api/inngest") return next();
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
  // Migration 0009: paused/archived/draft agents don't receive work. enabled=false
  // (a separate hard kill) is still enforced via the existing flag.
  if (agent.lifecycleState !== "active" || !agent.enabled) {
    return c.json({ hasWork: false, lifecycleState: agent.lifecycleState, enabled: agent.enabled }, 200);
  }

  if (peek) {
    const run = await peekNextRun(db, agentId, tenantId);
    return c.json({ hasWork: Boolean(run), run });
  }

  const claimed = await claimNextRun(db, agentId, tenantId, c.req.header("x-runner-id") ?? "runner");
  if (!claimed) return c.json({ hasWork: false }, 200);
  const bundle = await buildBundle(db, claimed.id, PUBLIC_URL, {
    resolveToken: tokenResolver,
    decryptEnv: vaultKey ? (blob) => decryptEnvValue(blob, vaultKey!) : undefined,
    retrieveKnowledge: async (query, namespaces) => {
      const hits = await retrieve(db, embedder, { tenantId, query, namespaces: namespaces.length ? namespaces : undefined, limit: 5 });
      return hits.map((h) => ({ chunk: h.content, source: h.vectorNamespace ?? "knowledge" }));
    },
  });
  return c.json({ hasWork: true, run: claimed, bundle });
});

app.put("/api/runs/:id/status", async (c) => {
  const { tenantId } = c.get("auth");
  const run = await ownedRun(tenantId, c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!RUN_STATUSES.includes(body.status)) return c.json({ error: "invalid status", valid: RUN_STATUSES }, 400);

  // Server-side budget enforcement (Step 1b, backend-agnostic). If the run's
  // reported cost meets/exceeds the agent's budgetCapUsd, override to 'failed'
  // and record a budget_cap autonomy event. This is the defense-in-depth that
  // protects against a runner forgetting to enforce its own max_budget_usd.
  let status: string = body.status;
  let summary: string | undefined = body.summary;
  if (typeof body.costUsd === "number") {
    const [agent] = await db
      .select({ budgetCapUsd: schema.agents.budgetCapUsd })
      .from(schema.agents)
      .where(eq(schema.agents.id, run.agentId))
      .limit(1);
    const cap = agent?.budgetCapUsd ? Number(agent.budgetCapUsd) : null;
    if (cap !== null && body.costUsd >= cap) {
      status = "failed";
      const note = `over budget: $${body.costUsd.toFixed(4)} / $${cap.toFixed(2)}`;
      summary = summary ? `${summary} (${note})` : note;
      await recordAutonomyEvent(db, {
        tenantId,
        runId: run.id,
        agentId: run.agentId,
        kind: "budget_cap",
        rationale: note,
      });
    }
  }

  const updated = await setRunStatus(
    db,
    run.id,
    {
      status,
      summary,
      tokensIn: body.tokensIn,
      tokensOut: body.tokensOut,
      costUsd: body.costUsd,
      sdkSessionId: body.sdkSessionId,
    },
    embedder, // done runs auto-index their summary into searchable memory
  );
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
    sdkSessionId: body.sdkSessionId ? String(body.sdkSessionId) : null,
  });
  // Mirror to Slack/Telegram (best-effort).
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, run.agentId)).limit(1);
  void sendApprovalNotification({
    agentName: agent?.name ?? "Agent",
    context: String(body.context),
    proposedAction: String(body.proposedAction),
    options: body.options,
  }).catch(() => {});
  return c.json({ approval }, 201);
});

// Human (or Slack/Telegram bridge) decides an approval → flips the run to pending.
app.post("/api/approvals/:id/decide", async (c) => {
  const { tenantId } = c.get("auth");
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  if (!b.optionKey) return c.json({ error: "optionKey required" }, 400);
  const [approval] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.id, id), eq(schema.approvals.tenantId, tenantId))).limit(1);
  if (!approval) return c.json({ error: "approval not found" }, 404);
  if (approval.status !== "open") return c.json({ error: "approval already decided" }, 409);
  const updated = await resolveApproval(db, id, String(b.optionKey), b.decidedBy ?? null);
  return c.json({ approval: updated, runStatus: "pending" });
});

// Autonomy gate event (PreToolUse/PostToolUse/Stop/SessionEnd decision target).
app.post("/api/runs/:id/autonomy-event", async (c) => {
  const { tenantId } = c.get("auth");
  const run = await ownedRun(tenantId, c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (!b.kind || !(AUTONOMY_EVENT_KINDS as readonly string[]).includes(b.kind)) {
    return c.json({ error: "invalid kind", valid: AUTONOMY_EVENT_KINDS }, 400);
  }
  const row = await recordAutonomyEvent(db, {
    tenantId,
    runId: run.id,
    agentId: run.agentId,
    kind: b.kind,
    toolName: b.toolName ?? null,
    rationale: b.rationale ?? null,
  });
  return c.json({ event: row }, 201);
});

// Audit log (PostToolUse hook target).
app.post("/api/runs/:id/audit", async (c) => {
  const { tenantId } = c.get("auth");
  const run = await ownedRun(tenantId, c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (!b.toolName) return c.json({ error: "toolName required" }, 400);
  const row = await writeAudit(db, { tenantId, runId: run.id, toolName: String(b.toolName), inputHash: b.inputHash ?? null, result: b.result ?? null });
  return c.json({ audit: row }, 201);
});

// Cost summary + budget status for the tenant.
app.get("/api/cost", async (c) => {
  const { tenantId } = c.get("auth");
  const sinceDays = Number(c.req.query("sinceDays") ?? 14);
  const [summary, budget] = await Promise.all([costSummary(db, tenantId, sinceDays), checkBudget(db, tenantId)]);
  return c.json({ summary, budget });
});

app.post("/api/docs", async (c) => {
  const { tenantId } = c.get("auth");
  const body = await c.req.json().catch(() => ({}));
  if (!body.name) return c.json({ error: "name required" }, 400);
  // A client-supplied projectId must belong to this tenant.
  if (body.projectId) {
    const [proj] = await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, body.projectId), eq(schema.projects.tenantId, tenantId))).limit(1);
    if (!proj) return c.json({ error: "project not found in tenant" }, 404);
  }
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
  // The agent must belong to this tenant — never create a job pointing at another tenant's agent.
  const [owned] = await db.select({ id: schema.agents.id }).from(schema.agents).where(and(eq(schema.agents.id, b.agentId), eq(schema.agents.tenantId, tenantId))).limit(1);
  if (!owned) return c.json({ error: "agent not found in tenant" }, 404);
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

// Provision a new client tenant by cloning the admin's tenant as a template
// (the AI ROI offer: onboard a client onto your workforce as fulfillment).
app.post("/api/admin/provision", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.name || !b.slug || !b.ownerUserId) return c.json({ error: "name, slug, ownerUserId required" }, 400);
  const result = await provisionClientTenant(db, {
    name: String(b.name),
    slug: String(b.slug),
    templateTenantId: tenantId, // clone YOUR workforce
    ownerUserId: String(b.ownerUserId),
    monthlyBudgetUsd: typeof b.monthlyBudgetUsd === "number" ? b.monthlyBudgetUsd : null,
  });
  return c.json(result, 201);
});

app.post("/api/admin/keys", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.kind || !b.name) return c.json({ error: "kind and name required" }, 400);
  const { raw, row } = await createApiKey(db, { tenantId, kind: b.kind, name: b.name });
  return c.json({ key: raw, id: row?.id, note: "Store this key now — it is shown only once." }, 201);
});

// ============================ Architect ============================
// Plain-English → N seeded agents. Spec: docs/specs/agent-architect.md
app.post("/api/admin/architect/propose", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.prompt !== "string" || !b.prompt.trim())
    return c.json({ error: "prompt required" }, 400);
  if (b.mode === "remix" && !b.baseAgentKey)
    return c.json({ error: "remix mode requires baseAgentKey" }, 400);
  if (!architectLlm)
    return c.json({ error: "architect not configured — set OPENROUTER_API_KEY" }, 501);
  try {
    const blueprint = await proposeBlueprint(
      { db, llm: architectLlm },
      {
        prompt: b.prompt,
        tenantId,
        userId: b.userId ?? null,
        mode: b.mode,
        baseAgentKey: b.baseAgentKey,
        llmBudgetUsd: typeof b.llmBudgetUsd === "number" ? b.llmBudgetUsd : undefined,
      },
    );
    return c.json({ blueprint }, 201);
  } catch (e) {
    if (e instanceof ArchitectError) return c.json({ error: e.message, code: e.code }, 400);
    throw e;
  }
});

app.get("/api/admin/architect/blueprints", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const limit = Number(c.req.query("limit") ?? 20);
  const blueprints = await listBlueprints(db, tenantId, Number.isFinite(limit) ? limit : 20);
  return c.json({ blueprints });
});

app.get("/api/admin/architect/blueprints/:id", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const blueprint = await loadBlueprint(db, tenantId, c.req.param("id"));
  if (!blueprint) return c.json({ error: "blueprint not found" }, 404);
  return c.json({ blueprint });
});

app.post("/api/admin/architect/seed", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.blueprintId !== "string")
    return c.json({ error: "blueprintId required" }, 400);
  try {
    const result = await seedFromBlueprint(db, {
      tenantId,
      blueprintId: b.blueprintId,
      skillSource: architectSkillSource,
    });
    return c.json(result, 201);
  } catch (e) {
    if (e instanceof ArchitectError) {
      return c.json({ error: e.message, code: e.code }, e.code === "not_found" ? 404 : 400);
    }
    throw e;
  }
});

// ============================ Agent lifecycle (Migration 0009) ============================
// The autonomous-team primitive: a manager agent (or a human operator) can
// transition an agent through draft -> active -> paused -> archived without
// deleting rows. The runner's /next path will refuse work for any agent
// whose lifecycle_state != 'active'.
const LIFECYCLE_TRANSITIONS = {
  activate: "active",
  pause: "paused",
  archive: "archived",
  draft: "draft",
} as const;

for (const [verb, state] of Object.entries(LIFECYCLE_TRANSITIONS)) {
  app.post(`/api/admin/agents/:id/${verb}`, requireAdmin, async (c) => {
    const { tenantId } = c.get("auth");
    const agentId = c.req.param("id");
    const [updated] = await db
      .update(schema.agents)
      .set({ lifecycleState: state })
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.tenantId, tenantId)))
      .returning({ id: schema.agents.id, key: schema.agents.key, lifecycleState: schema.agents.lifecycleState });
    if (!updated) return c.json({ error: "agent not found" }, 404);
    return c.json({ agent: updated });
  });
}

// PUT /api/admin/tenants/me/model-override  { model: "nousresearch/hermes-4-405b" | null }
// When set, all future seedAgent calls for this tenant rewrite spec.model to
// the override. Existing agent rows are unchanged until re-seeded — call
// /api/admin/tenants/me/apply-model-override to rewrite them in bulk.
app.put("/api/admin/tenants/me/model-override", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  const newOverride: string | null = typeof b.model === "string" && b.model.length ? b.model : null;
  const [updated] = await db
    .update(schema.tenants)
    .set({ defaultModelOverride: newOverride })
    .where(eq(schema.tenants.id, tenantId))
    .returning({ id: schema.tenants.id, defaultModelOverride: schema.tenants.defaultModelOverride });
  return c.json({ tenant: updated });
});

app.post("/api/admin/tenants/me/apply-model-override", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant?.defaultModelOverride)
    return c.json({ error: "no default_model_override set on this tenant" }, 400);
  const updated = await db
    .update(schema.agents)
    .set({ model: tenant.defaultModelOverride })
    .where(eq(schema.agents.tenantId, tenantId))
    .returning({ id: schema.agents.id, key: schema.agents.key, model: schema.agents.model });
  return c.json({
    applied: tenant.defaultModelOverride,
    rewritten: updated.length,
    agents: updated.map((a) => ({ key: a.key, model: a.model })),
  });
});

// ============================ Connections ============================
// List MCPs and their credential status (drives the Connections UI).
app.get("/api/connections", async (c) => {
  const { tenantId } = c.get("auth");
  const rows = await db.select().from(schema.mcps).where(eq(schema.mcps.tenantId, tenantId));
  const creds = await db.select().from(schema.oauthCredentials).where(eq(schema.oauthCredentials.tenantId, tenantId));
  const credByMcp = new Map(creds.map((cr) => [cr.mcpId, cr]));
  return c.json({
    connections: rows.map((m) => {
      const cr = credByMcp.get(m.id);
      return {
        id: m.id, name: m.name, transport: m.transport, authType: m.authType, status: m.status,
        lastHealthCheck: m.lastHealthCheck, hasCredential: Boolean(cr),
        scopes: cr?.scopes ?? [], expiresAt: cr?.expiresAt ?? null,
      };
    }),
  });
});

// Store/replace a credential for an MCP. In production this is called by the
// OAuth callback handler after the human consents; here it also enables manual
// setup. Requires the vault key to be configured.
app.post("/api/connections/:mcpId/credential", async (c) => {
  const { tenantId } = c.get("auth");
  if (!vaultKey) return c.json({ error: "vault not configured (AOS_VAULT_KEY)" }, 503);
  const mcpId = c.req.param("mcpId");
  const [mcp] = await db.select().from(schema.mcps).where(and(eq(schema.mcps.id, mcpId), eq(schema.mcps.tenantId, tenantId))).limit(1);
  if (!mcp) return c.json({ error: "mcp not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (!b.accessToken) return c.json({ error: "accessToken required" }, 400);
  await storeCredential(db, vaultKey, {
    tenantId, mcpId,
    accessToken: String(b.accessToken),
    refreshToken: b.refreshToken ? String(b.refreshToken) : undefined,
    scopes: Array.isArray(b.scopes) ? b.scopes : [],
    expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
  });
  return c.json({ ok: true, status: "connected" }, 201);
});

// ============================ Knowledge ============================
// Index a document's content into pgvector (chunk + embed + store).
app.post("/api/knowledge/index", async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.documentId || typeof b.content !== "string") return c.json({ error: "documentId and content required" }, 400);
  const [doc] = await db.select().from(schema.documents).where(and(eq(schema.documents.id, b.documentId), eq(schema.documents.tenantId, tenantId))).limit(1);
  if (!doc) return c.json({ error: "document not found" }, 404);
  const chunks = await indexDocument(db, embedder, {
    documentId: doc.id,
    tenantId,
    content: b.content,
    vectorNamespace: doc.vectorNamespace ?? `tenant/${tenantId}`,
  });
  return c.json({ ok: true, chunks }, 201);
});

// Vector-retrieve relevant chunks, scoped to the tenant (+ optional namespaces).
app.post("/api/knowledge/search", async (c) => {
  const { tenantId } = c.get("auth");
  const b = await c.req.json().catch(() => ({}));
  if (!b.query) return c.json({ error: "query required" }, 400);
  const results = await retrieve(db, embedder, {
    tenantId,
    query: String(b.query),
    namespaces: Array.isArray(b.namespaces) ? b.namespaces : undefined,
    limit: typeof b.limit === "number" ? b.limit : 5,
  });
  return c.json({ results });
});

// Only bind a port when run directly (not when imported by tests).
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Agent OS API listening on http://localhost:${info.port}`);
  });
}

export { app, db, embedder, vaultKey };
