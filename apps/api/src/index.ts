import { serve } from "@hono/node-server";
import { serve as inngestServe } from "inngest/hono";
import { applyModelFeedback, applyMonthlyCostRollup, inngest, runScheduledAgent, scoreAgentsScheduled } from "@agent-os/inngest";
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
  isCantFail,
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
  emit,
  type ApiKeyContext,
  type LlmClient,
} from "@agent-os/core";
import { checkTenantBudget, compareForecasts, inferTaskProfile, pickBestModel, suggestModelForBlueprint, type ModelCatalogEntry, type ModelSuggestion, type TaskProfile, type TokenEstimate } from "@agent-os/core";
import { loadModelCatalog, readTenantMonthToDateUsd } from "@agent-os/db";
import { RUN_STATUSES } from "@agent-os/shared";
import { decryptEnvValue, loadVaultKey, makeBundleTokenResolver, storeCredential } from "@agent-os/vault";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
// CR-07 fix: Inngest webhook is mounted before the project's api-key auth
// because Inngest signs its own requests with INNGEST_SIGNING_KEY. If that
// env var is unset in production, the webhook accepts unsigned POSTs and
// any caller can trigger every registered Inngest function (including
// cross-tenant scorecard runs via { agentId, tenantId } payloads).
// Fail loud at startup.
if (process.env.NODE_ENV === "production" && !process.env.INNGEST_SIGNING_KEY) {
  throw new Error(
    "INNGEST_SIGNING_KEY is required in production (NODE_ENV=production). " +
      "Without it, /api/inngest is unauthenticated and can be triggered by anyone " +
      "to invoke any registered Inngest function across any tenant.",
  );
}
if (!process.env.INNGEST_SIGNING_KEY) {
  console.warn(
    "[api] WARNING: INNGEST_SIGNING_KEY is unset. /api/inngest is unauthenticated. " +
      "Acceptable for local dev with INNGEST_DEV=1; never in production.",
  );
}

const app = new Hono<{ Variables: Vars }>();

// --- Public ---
app.get("/health", (c) => c.json({ ok: true }));
app.get("/api/guide", (c) => c.json(apiGuide));
app.get("/api/admin-guide", (c) => c.json(adminGuide));

// --- Inngest webhook (Plan 07-04) ---
// Mounted BEFORE the /api/* api-key middleware: Inngest authenticates inbound
// calls with INNGEST_SIGNING_KEY via its own serve handler, not the project
// bearer key, so this route must not pass through verifyApiKey.
app.on(
  ["GET", "POST", "PUT"],
  "/api/inngest",
  inngestServe({ client: inngest, functions: [runScheduledAgent, scoreAgentsScheduled, applyModelFeedback, applyMonthlyCostRollup] }),
);

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

/** Platform-owner gate. CR-01/02/03 fix: platform-global tables
 *  (models, model_feedback_proposals, the cross-tenant scorecard
 *  aggregate view) must NOT be exposed to per-tenant admin keys, or
 *  any Cliently client could read/write platform-wide state.
 *
 *  The platform owner is Acqu (tenant slug "acqu"). The runtime check
 *  is: caller's auth kind === "admin" AND their tenantId resolves to a
 *  tenant with slug "acqu". Operators can override via the
 *  PLATFORM_OWNER_TENANT_SLUG env var if the deployment uses a
 *  different platform tenant name. */
const PLATFORM_OWNER_SLUG = process.env.PLATFORM_OWNER_TENANT_SLUG ?? "acqu";
const requirePlatformOwner = async (
  c: { get: (k: "auth") => ApiKeyContext; json: (b: unknown, s?: number) => Response },
  next: () => Promise<void>,
) => {
  const auth = c.get("auth");
  if (auth.kind !== "admin") return c.json({ error: "admin key required" }, 403);
  const [tenant] = await db
    .select({ slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, auth.tenantId))
    .limit(1);
  if (!tenant || tenant.slug !== PLATFORM_OWNER_SLUG) {
    return c.json({
      error: "platform owner required — this endpoint accesses platform-global state",
    }, 403);
  }
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
      // Wave D: emit knowledge.retrieved. Best-effort — this is a read-path
      // enrichment with no legacy write to keep atomic with; a Relay failure
      // must not block the bundle from being served. Log on failure (never
      // swallow silently — but never fail the run either).
      await emit(db, {
        tenantId,
        eventName: "knowledge.retrieved",
        actor: "system",
        agentId: claimed.agentId,
        runId: claimed.id,
        payload: {
          namespaces: namespaces.length ? namespaces : null,
          hit_count: hits.length,
        },
      }).catch((e) => {
        console.error(`[api] knowledge.retrieved emit failed for run ${claimed.id}: ${(e as Error).message}`);
      });
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
  const row = await writeAudit(db, { tenantId, runId: run.id, agentId: run.agentId, toolName: String(b.toolName), inputHash: b.inputHash ?? null, result: b.result ?? null });
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
    backend: b.backend ?? "claude-agent-sdk", model: b.model ?? "anthropic/claude-sonnet-4.6", autonomy: b.autonomy ?? "propose",
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

    // Phase 56: run pickBestModel against each blueprint agent's composed
    // skill profile. Surface suggestions inline so the operator dashboard
    // can show LLM-emitted model vs. recommended model side-by-side; the
    // operator accepts or overrides before seedFromBlueprint.
    const catalog = (await loadModelCatalog(db)) as ModelCatalogEntry[];

    // Build an in-memory skill registry keyed by skill.key -> task_profile.
    // We pull all skills referenced by any blueprint agent in one shot.
    // The hydrated blueprint returns AgentSpec[] (post-hydrate shape) with
    // skills as { key, name }[]; we extract the keys for the suggestion call.
    const allSkillKeys = Array.from(
      new Set(
        (blueprint.agents ?? []).flatMap((a) =>
          (a.skills ?? []).map((s) => s.key),
        ),
      ),
    );
    const skillProfiles = new Map<string, TaskProfile>();
    if (allSkillKeys.length > 0) {
      const skillRows = await db
        .select({ key: schema.skills.key, taskProfile: schema.skills.taskProfile })
        .from(schema.skills)
        .where(and(eq(schema.skills.tenantId, tenantId), inArray(schema.skills.key, allSkillKeys)));
      for (const r of skillRows) {
        const p = r.taskProfile as Record<string, unknown> | undefined;
        if (p && typeof p === "object" && p.capabilities) {
          skillProfiles.set(r.key, p as unknown as TaskProfile);
        }
      }
    }
    const registry = {
      getTaskProfile: (skillKey: string) => skillProfiles.get(skillKey) ?? null,
    };

    const suggestions: Record<string, ModelSuggestion | null> = {};
    for (const a of blueprint.agents ?? []) {
      // Adapt AgentSpec -> AgentBlueprint shape for the suggestion call.
      const blueprintShape = {
        key: a.key,
        name: a.name,
        role: "", // not used by suggestModelForBlueprint
        systemPrompt: a.systemPrompt,
        model: a.model ?? "",
        autonomy: a.autonomy as "propose" | "execute_safe",
        knowledgeScope: a.knowledgeScope,
        budgetCapUsd: a.budgetCapUsd,
        cron: a.cron ?? null,
        skillKeys: (a.skills ?? []).map((s) => s.key),
        mcpNames: a.mcpNames ?? [],
      };
      suggestions[a.key] = suggestModelForBlueprint(blueprintShape, catalog, registry);
    }

    return c.json({ blueprint, modelSuggestions: suggestions }, 201);
  } catch (e) {
    if (e instanceof ArchitectError) return c.json({ error: e.message, code: e.code }, 400);
    throw e;
  }
});

// Phase 25: operator dashboard endpoints over agent_scorecards.
// GET /api/admin/scorecards?agent_id=<uuid>&limit=20 — recent scorecards
// GET /api/admin/scorecards/latest — most recent scorecard per agent
app.get("/api/admin/scorecards", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const agentIdFilter = c.req.query("agent_id");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const where = agentIdFilter
    ? and(eq(schema.agentScorecards.tenantId, tenantId), eq(schema.agentScorecards.agentId, agentIdFilter))
    : eq(schema.agentScorecards.tenantId, tenantId);
  const rows = await db
    .select()
    .from(schema.agentScorecards)
    .where(where)
    .orderBy(desc(schema.agentScorecards.createdAt))
    .limit(Number.isFinite(limit) ? limit : 50);
  return c.json({ scorecards: rows });
});

// Phase 29: cross-tenant aggregate (moat lens) — reads from the
// agent_scorecards_xtenant_agg view created by migration 0014. NOT
// scoped to the caller's tenant; surfaces the AVERAGE behavior of an
// agent class across every tenant on the platform. Operators use this
// to spot agent classes that promote fast (good archetypes to clone) vs.
// agent classes that demote often (archetypes to deprecate).
app.get("/api/admin/scorecards/xtenant-agg", requirePlatformOwner, async (c) => {
  const verdict = c.req.query("verdict"); // optional filter
  const minScorecardCount = Math.max(1, Number(c.req.query("min_scorecard_count") ?? 1));

  // WR-11 fix: validate verdict against the canonical enum so we don't
  // silently return zero rows on a typo or accept arbitrary strings.
  const VERDICTS = ["promote", "hold", "demote", "force_demote_safety", "insufficient_data"];
  if (verdict && !VERDICTS.includes(verdict)) {
    return c.json({ error: `invalid verdict; must be one of: ${VERDICTS.join(", ")}` }, 400);
  }

  const verdictFilter = verdict
    ? sql`AND verdict = ${verdict}`
    : sql``;
  const rows = await db.execute<{
    agent_key: string;
    verdict: string;
    scorecard_count: number;
    avg_verification_rate: number | null;
    avg_approval_rate: number | null;
    avg_cost_utilization: number | null;
    avg_findings_rate: number | null;
    total_cantfail_events: number | null;
    window_earliest: Date | null;
    window_latest: Date | null;
  }>(sql`
    SELECT agent_key, verdict, scorecard_count, avg_verification_rate,
           avg_approval_rate, avg_cost_utilization, avg_findings_rate,
           total_cantfail_events, window_earliest, window_latest
    FROM agent_scorecards_xtenant_agg
    WHERE scorecard_count >= ${minScorecardCount}
    ${verdictFilter}
    ORDER BY scorecard_count DESC
    LIMIT 200
  `);
  return c.json({ rows });
});

// ============================ Tenant budget (Phase 53) ============
// GET /api/admin/tenants/me/budget-status — month-to-date USD spend +
// cap status + linear EOM projection.
app.get("/api/admin/tenants/me/budget-status", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const [tenant] = await db
    .select({ monthlyBudgetUsd: schema.tenants.monthlyBudgetUsd })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  const cap = tenant?.monthlyBudgetUsd != null ? Number(tenant.monthlyBudgetUsd) : null;
  const mtd = await readTenantMonthToDateUsd(db, tenantId);
  const status = checkTenantBudget({
    monthlyBudgetUsd: cap,
    monthToDateUsd: mtd,
  });
  // Linear EOM projection: if today is day N of M total days in the
  // month, project = mtd * M / N.
  const now = new Date();
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const projectionEom = dayOfMonth > 0 ? (mtd * totalDays) / dayOfMonth : mtd;
  return c.json({
    cap_usd: cap,
    month_to_date_usd: mtd,
    remaining_usd: status.remainingUsd,
    percent_used: status.percentUsed,
    projection_eom_usd: projectionEom,
    warning: status.reason ?? null,
  });
});

app.get("/api/admin/scorecards/latest", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  // Most recent scorecard per agent. Drizzle doesn't have DISTINCT ON natively,
  // so we use a window function via raw SQL through a subquery.
  const rows = await db.execute<{
    id: string;
    agent_id: string;
    agent_key: string;
    verdict: string;
    rationale: string;
    applied_autonomy: string | null;
    sample_size: number;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (agent_id)
      id, agent_id, agent_key, verdict, rationale, applied_autonomy,
      sample_size, created_at
    FROM agent_scorecards
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY agent_id, created_at DESC
  `);
  return c.json({ scorecards: rows });
});

// ============================ Model Intelligence (Phase 42) ============
//
// Front-end / operator surface for the catalog (Phase 38) + intelligent
// picker (Phase 39). These endpoints let the chat workspace ("describe
// what you want; spin up an agent") consult the picker live and show
// ranked candidates with rationale.

// GET /api/admin/models — list the full catalog.
app.get("/api/admin/models", requirePlatformOwner, async (c) => {
  const status = c.req.query("status"); // optional filter: preferred|secondary|...
  const provider = c.req.query("provider"); // optional filter
  const catalog = await loadModelCatalog(db);
  let rows: ModelCatalogEntry[] = catalog as ModelCatalogEntry[];
  if (status) rows = rows.filter((r) => r.status === status);
  if (provider) rows = rows.filter((r) => r.provider === provider);
  return c.json({ models: rows });
});

// POST /api/admin/models/recommend — body { profile: TaskProfile, options? }
// Returns ranked candidates with rationale. The chat workspace posts a
// TaskProfile derived from natural-language intent and shows the user the
// top picks before spinning up the agent.
app.post("/api/admin/models/recommend", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const profile = (body as { profile?: TaskProfile }).profile;
  if (!profile || typeof profile !== "object" || !profile.capabilities) {
    return c.json(
      {
        error:
          "body.profile must include a capabilities object — see TaskProfile in @agent-os/core",
      },
      400,
    );
  }
  const options = (body as { options?: { topN?: number; baselineCostIndex?: number; excludeTCritical?: boolean } }).options ?? {};
  const catalog = (await loadModelCatalog(db)) as ModelCatalogEntry[];
  const result = pickBestModel(catalog, profile, options);
  return c.json({
    pick: result.pick,
    candidates: result.candidates,
    filtered: result.filtered,
    profile,
  });
});

// POST /api/admin/chat/dispatch — Phase 43 chat-workspace dispatch surface.
//
// Body shape:
//   {
//     intent: string,                          // natural-language task description
//     profile: TaskProfile,                    // derived by the front-end (or
//                                              //   inferred via the architect's
//                                              //   LLM in a future iteration)
//     agentKey?: string,                       // existing agent to dispatch (else
//                                              //   the chat returns a recommendation
//                                              //   without actually running anything)
//     dryRun?: boolean
//   }
//
// Returns:
//   {
//     pick: ScoredCandidate,                   // recommended model
//     candidates: ScoredCandidate[],           // ranked alternatives
//     filtered: { slug, reason }[],            // why we dropped candidates
//     dispatchedRunId?: string,                // present when agentKey provided
//                                              //   and dryRun !== true
//   }
//
// This is the load-bearing surface for the chat workspace the operator
// described — type intent, see ranked model picks, confirm dispatch.
app.post("/api/admin/chat/dispatch", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as {
    intent?: string;
    profile?: TaskProfile;
    agentKey?: string;
    dryRun?: boolean;
    /** Phase 50: optional cost-forecast inputs. When tokens supplied,
     *  the response includes per-candidate USD forecasts and a
     *  recommendation that respects budgetCapUsd. */
    tokens?: TokenEstimate;
    budgetCapUsd?: number;
    /** Phase 51: optional inference hints. When profile is absent but
     *  intent is present, the endpoint runs inferTaskProfile to derive
     *  a TaskProfile from the intent. */
    hints?: {
      hasImage?: boolean;
      requiresLongDoc?: boolean;
      expectsCode?: boolean;
      requiresTools?: boolean;
    };
  };

  // Phase 51 fix: when profile is absent but intent is present, infer
  // a profile from the intent. Front-end no longer needs to author one.
  let inferredProfile: ReturnType<typeof inferTaskProfile> | null = null;
  let effectiveProfile = body.profile;
  if (!effectiveProfile || !effectiveProfile.capabilities) {
    if (!body.intent || typeof body.intent !== "string" || body.intent.length === 0) {
      return c.json(
        {
          error:
            "either body.profile (with capabilities) OR body.intent is required (see TaskProfile in @agent-os/core)",
        },
        400,
      );
    }
    inferredProfile = inferTaskProfile({ intent: body.intent, hints: body.hints });
    effectiveProfile = inferredProfile.profile;
  }

  // 1. Run the intelligent picker.
  const catalog = (await loadModelCatalog(db)) as ModelCatalogEntry[];
  const recommendation = pickBestModel(catalog, effectiveProfile);
  if (!recommendation.pick) {
    return c.json(
      {
        error: "no model in the catalog satisfies the requested profile",
        filtered: recommendation.filtered,
      inferredProfile,
      },
      422,
    );
  }

  // Phase 50: layer in the cost forecast when tokens supplied.
  const forecast = body.tokens
    ? compareForecasts({
        catalog,
        tokens: body.tokens,
        profile: effectiveProfile,
        budgetCapUsd: body.budgetCapUsd,
      })
    : null;

  // Phase 53: tenant-level monthly cap gate. When tokens were supplied
  // AND the forecast yields a non-null pick, derive the run-level cost
  // and check against tenants.monthly_budget_usd. Refuse with 422 +
  // budget.tenant_cap_breached emit when the run would breach the
  // monthly cap. dryRun runs are NOT gated (operator can preview).
  let tenantBudget: import("@agent-os/core").TenantBudgetCheck | null = null;
  if (forecast?.recommended && !body.dryRun) {
    const [t] = await db
      .select({ monthlyBudgetUsd: schema.tenants.monthlyBudgetUsd })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);
    const cap = t?.monthlyBudgetUsd != null ? Number(t.monthlyBudgetUsd) : null;
    const mtd = await readTenantMonthToDateUsd(db, tenantId);
    const forecastUsd = forecast.recommended.forecast.totalUsd;
    tenantBudget = checkTenantBudget({
      monthlyBudgetUsd: cap,
      monthToDateUsd: mtd,
      forecastUsd,
    });
    if (!tenantBudget.ok) {
      // Best-effort emit of budget.tenant_cap_breached.
      try {
        await emit(db, {
          tenantId,
          eventName: "budget.tenant_cap_breached",
          actor: "system",
          agentId: null,
          runId: null,
          payload: {
            cap_usd: cap,
            month_to_date_usd: mtd,
            forecast_usd: forecastUsd,
            projected_after_run_usd: tenantBudget.projectedAfterRunUsd,
            source: "chat.dispatch",
            reason: tenantBudget.reason ?? "",
          },
          piiClass: "none",
        });
      } catch (e) {
        console.error(`[api] budget.tenant_cap_breached emit failed: ${(e as Error).message}`);
      }
      return c.json(
        {
          error: "tenant monthly budget exceeded",
          tenant_budget: tenantBudget,
          inferredProfile,
        },
        422,
      );
    }
  }

  // 2. If no agentKey, return the recommendation only.
  if (!body.agentKey) {
    return c.json({
      intent: body.intent ?? null,
      pick: recommendation.pick,
      candidates: recommendation.candidates,
      filtered: recommendation.filtered,
      inferredProfile,
      tenantBudget,
      forecast,
      dispatchedRunId: null,
    });
  }

  // 3. agentKey provided + dryRun !== true: schedule a one-shot run.
  if (body.dryRun) {
    return c.json({
      intent: body.intent ?? null,
      pick: recommendation.pick,
      candidates: recommendation.candidates,
      filtered: recommendation.filtered,
      inferredProfile,
      tenantBudget,
      forecast,
      dispatchedRunId: null,
      dryRun: true,
    });
  }

  const [agent] = await db
    .select({ id: schema.agents.id, key: schema.agents.key })
    .from(schema.agents)
    .where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.key, body.agentKey)));
  if (!agent) {
    return c.json({ error: `agent ${body.agentKey} not found in tenant` }, 404);
  }

  // Insert a one-shot run; the runner picks it up via /api/agents/:id/next.
  const [run] = await db
    .insert(schema.runs)
    .values({
      tenantId,
      agentId: agent.id,
      status: "scheduled",
      triggerSource: "chat",
      scheduledFor: new Date(),
      summary: body.intent ?? "Chat-dispatched run",
    })
    .returning({ id: schema.runs.id });

  return c.json({
    intent: body.intent ?? null,
    pick: recommendation.pick,
    candidates: recommendation.candidates,
    filtered: recommendation.filtered,
      inferredProfile,
      tenantBudget,
    forecast,
    dispatchedRunId: run?.id ?? null,
    agentKey: body.agentKey,
  });
});

// ============================ Cost forecasting (Phase 46) ============
// POST /api/admin/models/forecast — body { tokens, profile?, budgetCapUsd? }
// Returns per-candidate forecasts with the recommended pick.
app.post("/api/admin/models/forecast", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    tokens?: { inputTokens: number; outputTokens: number };
    profile?: import("@agent-os/core").TaskProfile;
    budgetCapUsd?: number;
  };
  if (!body.tokens || typeof body.tokens.inputTokens !== "number" || typeof body.tokens.outputTokens !== "number") {
    return c.json({ error: "body.tokens.inputTokens and body.tokens.outputTokens are required" }, 400);
  }
  const { compareForecasts } = await import("@agent-os/core");
  const catalog = (await loadModelCatalog(db)) as import("@agent-os/core").ModelCatalogEntry[];
  const result = compareForecasts({
    catalog,
    tokens: body.tokens,
    profile: body.profile,
    budgetCapUsd: body.budgetCapUsd,
  });
  return c.json(result);
});

// ============================ Artifacts (Phase 47) ====================
// GET /api/admin/runs/:runId/artifacts — list artifacts for a run
app.get("/api/admin/runs/:runId/artifacts", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const runId = c.req.param("runId");
  const rows = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.tenantId, tenantId), eq(schema.artifacts.runId, runId)))
    .orderBy(desc(schema.artifacts.createdAt));
  return c.json({ artifacts: rows });
});

// POST /api/admin/runs/:runId/artifacts — register an artifact
// Body: { kind, name, uri?, inlinePayload?, metadata? }
app.post("/api/admin/runs/:runId/artifacts", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const runId = c.req.param("runId");
  const body = await c.req.json().catch(() => ({})) as {
    kind?: string;
    name?: string;
    uri?: string;
    inlinePayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  const ALLOWED_KINDS = ["file", "doc", "spreadsheet", "image", "link", "json", "markdown", "code"];
  if (!body.kind || !ALLOWED_KINDS.includes(body.kind)) {
    return c.json({ error: `kind must be one of ${ALLOWED_KINDS.join(", ")}` }, 400);
  }
  if (!body.name) return c.json({ error: "name is required" }, 400);
  if (!body.uri && !body.inlinePayload) {
    return c.json({ error: "either uri or inlinePayload is required" }, 400);
  }

  // WR-07 fix: cap inline_payload at 16 KB. The column is for small
  // artifacts that ride inline so the front-end renders without a
  // second fetch. Large payloads belong in object storage with a uri.
  if (body.inlinePayload) {
    const serialized = JSON.stringify(body.inlinePayload);
    const MAX_INLINE_BYTES = 16 * 1024;
    if (serialized.length > MAX_INLINE_BYTES) {
      return c.json({
        error: `inlinePayload exceeds ${MAX_INLINE_BYTES} bytes (${serialized.length}). Use the uri field with object storage instead.`,
      }, 413);
    }
  }

  const [run] = await db
    .select({ id: schema.runs.id, agentId: schema.runs.agentId })
    .from(schema.runs)
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.tenantId, tenantId)));
  if (!run) return c.json({ error: "run not found" }, 404);

  const [row] = await db
    .insert(schema.artifacts)
    .values({
      tenantId,
      runId,
      agentId: run.agentId,
      kind: body.kind,
      name: body.name,
      uri: body.uri ?? null,
      inlinePayload: body.inlinePayload ?? null,
      metadata: body.metadata ?? {},
    })
    .returning();
  return c.json({ artifact: row });
});

// GET /api/admin/artifacts/recent — list recent artifacts across the tenant
// For the "output type of interface" the operator described — a feed of
// everything produced.
app.get("/api/admin/artifacts/recent", requireAdmin, async (c) => {
  const { tenantId } = c.get("auth");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const kind = c.req.query("kind");
  const where = kind
    ? and(eq(schema.artifacts.tenantId, tenantId), eq(schema.artifacts.kind, kind))
    : eq(schema.artifacts.tenantId, tenantId);
  const rows = await db
    .select()
    .from(schema.artifacts)
    .where(where)
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(Number.isFinite(limit) ? limit : 50);
  return c.json({ artifacts: rows });
});

// ============================ Model feedback proposals (Phase 45) ====
// GET /api/admin/models/proposals — list pending + recently-applied
app.get("/api/admin/models/proposals", requirePlatformOwner, async (c) => {
  const status = c.req.query("status") ?? "pending";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await db
    .select()
    .from(schema.modelFeedbackProposals)
    .where(eq(schema.modelFeedbackProposals.status, status as "pending" | "applied" | "rejected" | "superseded"))
    .orderBy(desc(schema.modelFeedbackProposals.createdAt))
    .limit(Number.isFinite(limit) ? limit : 50);
  return c.json({ proposals: rows });
});

// POST /api/admin/models/proposals/:id/decide — body { decision: "apply"|"reject" }
app.post("/api/admin/models/proposals/:id/decide", requirePlatformOwner, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as { decision?: "apply" | "reject" };
  if (body.decision !== "apply" && body.decision !== "reject") {
    return c.json({ error: "decision must be 'apply' or 'reject'" }, 400);
  }
  const [proposal] = await db
    .select()
    .from(schema.modelFeedbackProposals)
    .where(eq(schema.modelFeedbackProposals.id, id));
  if (!proposal) return c.json({ error: "proposal not found" }, 404);
  if (proposal.status !== "pending") return c.json({ error: `proposal already ${proposal.status}` }, 409);

  if (body.decision === "reject") {
    await db
      .update(schema.modelFeedbackProposals)
      .set({ status: "rejected", appliedAt: new Date(), appliedBy: "operator" })
      .where(eq(schema.modelFeedbackProposals.id, id));
    return c.json({ ok: true, status: "rejected" });
  }

  // Apply: update the model's capability_scores atomically.
  // CR-06 fix: use Postgres jsonb concatenation (||) so concurrent
  // operator decisions on different capabilities of the same model
  // don't clobber each other via read-modify-write. The single-key
  // jsonb patch is server-side atomic.
  const patchJson = JSON.stringify({ [proposal.capability]: Number(proposal.proposedScore) });
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE models
      SET capability_scores = capability_scores || ${patchJson}::jsonb,
          last_observed_at = NOW()
      WHERE slug = ${proposal.modelSlug}
    `);
    await tx
      .update(schema.modelFeedbackProposals)
      .set({ status: "applied", appliedAt: new Date(), appliedBy: "operator" })
      .where(eq(schema.modelFeedbackProposals.id, id));
  });
  return c.json({ ok: true, status: "applied" });
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

  // CR-07 fix: validate the slug against the catalog and refuse any
  // T-critical-pinned model. An operator who pins non-cantfail agents
  // to Opus would exhaust their budget cap at 25x the price of Sonnet.
  // T-critical slugs are reserved for the can't-fail agents and must
  // never be honored as a tenant default override.
  if (newOverride !== null) {
    const catalog = await loadModelCatalog(db);
    const candidate = catalog.find((m) => m.slug === newOverride);
    if (!candidate) {
      return c.json({
        error: `model slug "${newOverride}" is not in the catalog`,
        catalog_slugs: catalog.filter((m) => m.enabled && m.status !== "deprecated").map((m) => m.slug),
      }, 400);
    }
    if (candidate.tierAffinity === "T-critical") {
      return c.json({
        error: `T-critical models cannot be set as a tenant default override (Tier wins, override loses — CLAUDE.md non-negotiable)`,
        rejected_slug: newOverride,
      }, 400);
    }
  }

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

  // CR-04 fix: T-critical can't-fail agents are EXEMPT from
  // tenants.default_model_override per CLAUDE.md non-negotiable
  // ("Tier wins, override loses"). Filter them out of the bulk rewrite.
  // Without this, every T-critical agent in the tenant would be rewritten
  // to a non-Opus model, then fail-closed at runtime via
  // assertCantFailModel + cantfail.model_violation — non-functional until
  // re-seeded.
  const allAgents = await db
    .select({ id: schema.agents.id, key: schema.agents.key })
    .from(schema.agents)
    .where(eq(schema.agents.tenantId, tenantId));
  const overridable = allAgents.filter((a) => !isCantFail(a.key));
  const skipped = allAgents.filter((a) => isCantFail(a.key)).map((a) => a.key);
  const overridableIds = overridable.map((a) => a.id);

  if (overridableIds.length === 0) {
    return c.json({
      applied: tenant.defaultModelOverride,
      rewritten: 0,
      skipped_cantfail: skipped,
      agents: [],
    });
  }

  const updated = await db
    .update(schema.agents)
    .set({ model: tenant.defaultModelOverride })
    .where(
      and(eq(schema.agents.tenantId, tenantId), inArray(schema.agents.id, overridableIds)),
    )
    .returning({ id: schema.agents.id, key: schema.agents.key, model: schema.agents.model });

  return c.json({
    applied: tenant.defaultModelOverride,
    rewritten: updated.length,
    skipped_cantfail: skipped,
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
