# Phase 7: Tools registry + Inngest scheduler + Browserbase tool.browser — Pattern Map

**Mapped:** 2026-05-30
**Files analyzed:** 13 new/modified files
**Analogs found:** 12 / 13 (the runner-side `allowedTools` + custom-tool dispatch has no existing analog — first of its kind in the codebase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/0007_tools_registry.sql` | migration | DDL | `supabase/migrations/0001_init.sql` (agent_skills/agent_mcps + RLS), `0006_architect_blueprints.sql` | exact (mirror of skills/mcps lift) |
| `supabase/migrations/0008_pg_cron_inngest.sql` | migration | DDL + SQL function | `supabase/migrations/0002_pg_cron.sql` (aos_job_cron_command) | exact (same file, function rewrite) |
| `packages/db/src/schema.ts` (modified — add `tools`, `agentTools`) | model | typed schema | existing `mcps` + `agentMcps` blocks (lines 109–116, 194–206) | exact |
| `packages/core/src/seed/seedAgent.ts` (modified — `AgentSpec.tools`, `ensureTool`, `findToolByKey`, `bindTool`) | service | upsert/bind | existing `ensureSkillFromDir`, `findMcpByName`, `bindSkill`, `bindMcp` (same file) | exact (in-file precedent) |
| `packages/core/src/bundle.ts` (modified — `Bundle.tools[]`) | service | read/assemble | existing `mcpServers` block (lines 83–86, 135–147) | exact |
| `packages/inngest/package.json` + `src/index.ts` + `src/client.ts` | config + package | workspace package | `packages/vault/package.json` + `packages/registry/package.json` | exact (workspace shape) |
| `packages/inngest/src/functions/runScheduled.ts` | service | event-driven | `apps/scheduler/src/index.ts` `tick()` + `evaluateDueJobs` call | role-match (event-driven vs interval; both produce `runs`) |
| `apps/api/src/index.ts` (modified — Hono mount `/api/inngest`) | controller | request-response (webhook) | existing `requireAdmin` + admin-scoped Hono routes (lines 99–102, 387–447) | exact (Hono mount pattern) |
| `packages/tool-browser/package.json` + `src/index.ts` + `src/types.ts` | config + package | workspace package | `packages/vault/package.json` + `src/index.ts` | exact (workspace shape) |
| `packages/tool-browser/src/handler.ts` | service | transform (request → browser output) | `packages/vault/src/index.ts` `storeCredential` (try/finally, external SDK wrap) | role-match (external SDK wrap) |
| `apps/runner/src/execute.ts` (modified — `allowedTools` + custom dispatch) | service | streaming (SDK loop) | existing `liveRun` setup (lines 109–164); custom dispatch has **no analog** | partial (allowedTools wiring is new) |
| `scripts/seed/acqu-tool-browser.ts` | utility (seed script) | DDL data | `scripts/seed/acqu-vitals.ts` (canonical seed shape) | exact |
| `packages/core/src/integration.test.ts` (extended — P7-SC1.*) | test | integration | existing assertions in same file (lines 36–55 head) | exact (extend in-place) |
| `apps/api/src/app.test.ts` (extended — `/api/inngest` introspection) | test | integration | existing `app.request` pattern in same file (lines 1–80) | exact (extend in-place) |

## Pattern Assignments

### `supabase/migrations/0007_tools_registry.sql` (migration, DDL)

**Analog:** `supabase/migrations/0001_init.sql` (agent_skills/agent_mcps + RLS, lines 144–155 + 445–453) and `supabase/migrations/0006_architect_blueprints.sql` (top-level table with RLS, lines 5–34).

**Table-with-RLS pattern** (from 0006, lines 5–34):
```sql
create table if not exists architect_blueprints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ...
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'seeded', 'rejected', 'superseded')),
  ...
  created_at timestamptz not null default now()
);
create index if not exists architect_blueprints_tenant_status_idx
  on architect_blueprints (tenant_id, status, created_at desc);
alter table architect_blueprints enable row level security;
create policy architect_blueprints_rw on architect_blueprints
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
```

**Join-table-without-tenant_id pattern** (from 0001, lines 150–155 + 450–453):
```sql
create table agent_mcps (
  agent_id uuid not null references agents(id) on delete cascade,
  mcp_id   uuid not null,
  primary key (agent_id, mcp_id)
);
-- ...
alter table agent_mcps enable row level security;
create policy agent_mcps_rw on agent_mcps
  using (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)))
  with check (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)));
```

**Apply by:** copying the `agent_mcps` table + RLS block verbatim, swapping `mcp_id`/`agent_mcps` for `tool_id`/`agent_tools`. The `tools` table itself follows the `architect_blueprints` top-level pattern (uuid PK + `tenant_id` FK + `is_tenant_member(tenant_id)` RLS + `unique (tenant_id, key)` like `mcps`/`skills` already have).

---

### `supabase/migrations/0008_pg_cron_inngest.sql` (migration, function rewrite)

**Analog:** `supabase/migrations/0002_pg_cron.sql` lines 25–39 (`aos_job_cron_command`) and the backfill block lines 89–95.

**Existing function being rewritten** (0002, lines 25–39):
```sql
create or replace function aos_job_cron_command(p_job uuid)
  returns text language sql stable
  as $$
    select format(
      $cmd$insert into runs (tenant_id, agent_id, job_id, status, trigger_source, scheduled_for)
           select j.tenant_id, j.agent_id, j.id, 'scheduled', 'schedule', date_trunc('minute', now())
           from jobs j
           where j.id = %L and j.enabled
             and not exists (
               select 1 from runs r
               where r.job_id = j.id and r.scheduled_for = date_trunc('minute', now())
             );$cmd$,
      p_job
    );
  $$;
```

**Existing backfill loop** (0002, lines 88–95) that the new migration must re-run after `create or replace`:
```sql
do $$
declare j record;
begin
  for j in select id, schedule_cron from jobs where enabled loop
    perform aos_schedule_job(j.id, j.schedule_cron);
  end loop;
end $$;
```

**Apply by:** `create or replace function aos_job_cron_command(...)` returning `select format(...)` where the inner command is `select net.http_post(url := current_setting('app.inngest_event_url'), body := jsonb_build_object('name','aos/agent.scheduled','data',jsonb_build_object('jobId',%L)), headers := jsonb_build_object('content-type','application/json'));`. Then re-run the backfill block verbatim so all live `cron.job` entries get the new command. Keep `format(%L)` for safe quoting — no string concat (the existing pattern already prevents SQL injection).

---

### `packages/db/src/schema.ts` (modified — add `tools` + `agentTools`)

**Analog:** existing `mcps` and `agentMcps` blocks in the same file.

**Existing `mcps` block** (lines 194–206):
```typescript
export const mcps = pgTable("mcps", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  transport: text("transport").notNull().default("http"),
  endpoint: text("endpoint"),
  authType: text("auth_type").notNull().default("none"),
  scope: text("scope").notNull().default("global"),
  status: text("status").notNull().default("disconnected"),
  lastHealthCheck: timestamp("last_health_check", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

**Existing `agentMcps` join** (lines 109–116):
```typescript
export const agentMcps = pgTable(
  "agent_mcps",
  {
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    mcpId: uuid("mcp_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.mcpId] })],
);
```

**Apply by:** add `tools` and `agentTools` pgTable exports mirroring this exact shape. Columns map 1:1 with the SQL in migration 0007 (camelCase TS names → snake_case columns; `jsonb()` for `inputSchema`; `boolean()` for `requiresApproval`/`reversible`). Place `agentTools` immediately after `agentMcps` and `tools` immediately after `mcps` so adjacent code blocks remain visually grouped.

**Critical pitfall (from RESEARCH §Pitfall 6):** do NOT run `pnpm db:generate`. Hand-edit `schema.ts` to mirror the hand-written 0007 SQL.

---

### `packages/core/src/seed/seedAgent.ts` (modified — `tools` extension)

**Analog:** same file. Three existing patterns must be mirrored.

**Existing `ensureSkillFromDir` pattern** (lines 38–84) — DB-backed upsert helper with a "lookup → insert-if-missing → update-if-changed" shape:
```typescript
export async function ensureSkillFromDir(
  db: Db, tenantId: string, args: { key: string; name: string }, source: SkillSource,
) {
  const [existing] = await db.select().from(schema.skills)
    .where(and(eq(schema.skills.tenantId, tenantId), eq(schema.skills.key, args.key)))
    .limit(1);
  // ...compute content/version
  if (!existing) {
    const [row] = await db.insert(schema.skills).values({ tenantId, key: args.key, name: args.name, /* ... */ }).returning();
    return row!;
  }
  // ...update if version drift
  return existing;
}
```

**Existing `findMcpByName` pattern** (lines 88–99) — lookup-or-throw used for already-seeded refs:
```typescript
export async function findMcpByName(db: Db, tenantId: string, name: string) {
  const [row] = await db.select().from(schema.mcps)
    .where(and(eq(schema.mcps.tenantId, tenantId), eq(schema.mcps.name, name)))
    .limit(1);
  if (!row) throw new Error(`MCP "${name}" not seeded for tenant ${tenantId} — run \`pnpm db:seed\` first.`);
  return row;
}
```

**Existing `bindSkill` + `bindMcp` pattern** (lines 238–248) — idempotent insert-or-noop on the join table via raw SQL with `sql` template tag:
```typescript
export async function bindSkill(db: Db, agentId: string, skillId: string) {
  await db.execute(
    sql`insert into agent_skills (agent_id, skill_id) values (${agentId}, ${skillId}) on conflict do nothing`,
  );
}

export async function bindMcp(db: Db, agentId: string, mcpId: string) {
  await db.execute(
    sql`insert into agent_mcps (agent_id, mcp_id) values (${agentId}, ${mcpId}) on conflict do nothing`,
  );
}
```

**Existing `AgentSpec` shape** (lines 252–270) — note `skills` is required, `mcpNames` is required; new `tools` MUST be optional:
```typescript
export type AgentSpec = {
  tenantId: string;
  key: string;
  name: string;
  // ...
  skills: { key: string; name: string }[];
  mcpNames: string[];
  // ADD: tools?: { key: string; name: string }[];   ← optional, defaults to []
};
```

**Existing `seedAgent` orchestration** (lines 287–323) — parallel ensures, then `for (...) await bindX(...)`:
```typescript
const skillRows = await Promise.all(
  spec.skills.map((s) => ensureSkillFromDir(db, spec.tenantId, s, options.skillSource)),
);
const mcpRows = await Promise.all(spec.mcpNames.map((n) => findMcpByName(db, spec.tenantId, n)));
// ...upsertAgent / upsertCurrentPrompt / triggers...
for (const s of skillRows) await bindSkill(db, agent.id, s.id);
for (const m of mcpRows) await bindMcp(db, agent.id, m.id);
```

**Apply by:** add `ensureTool(db, tenantId, args)` mirroring `ensureSkillFromDir` (but without disk read; tools are pure DB rows). Add `bindTool(db, agentId, toolId)` as a 4th line in the binding block. In `seedAgent`, add `const toolRows = await Promise.all((spec.tools ?? []).map((t) => ensureTool(db, spec.tenantId, t)));` and `for (const t of toolRows) await bindTool(db, agent.id, t.id);`. Extend `AgentSeedResult` with `tools: string[]`. **Backward compat is preserved by the `?? []` default** — every existing seed script (vitals, ad-ops, etc.) continues to pass without modification.

---

### `packages/core/src/bundle.ts` (modified — `Bundle.tools[]`)

**Analog:** existing `mcpServers` block in the same file.

**Existing `Bundle.mcpServers` field** (lines 30–37):
```typescript
mcpServers: {
  name: string;
  transport: string;
  endpoint: string | null;
  authType: string;
  scope: string;
  credentials: { vaultRef?: string; token?: string; ttlSeconds: number } | null;
}[];
```

**Existing fetch + map pattern** (lines 82–86 + 135–147):
```typescript
const agentMcpRows = await db.select().from(agentMcps).where(eq(agentMcps.agentId, agent.id));
const mcpIds = agentMcpRows.map((r) => r.mcpId);
// ...
const [_, _, mcpRows, _] = await Promise.all([
  // ...
  mcpIds.length ? db.select().from(mcps).where(inArray(mcps.id, mcpIds)) : Promise.resolve([]),
  // ...
]);
// ...later...
mcpServers: await Promise.all(
  mcpRows.map(async (m) => {
    // ...credentials resolution...
    return { name: m.name, transport: m.transport, endpoint: m.endpoint, authType: m.authType, scope: m.scope, credentials };
  }),
),
```

**Apply by:** add `tools` to the destructured `schema` import. Add `const agentToolRows = await db.select().from(agentTools).where(eq(agentTools.agentId, agent.id));`, fetch matching `tools` rows in the existing `Promise.all`, and map to `bundle.tools` with `{ key, name, kind, inputSchema, requiresApproval, reversible }`. No credentials resolution needed (tools don't carry OAuth) — simpler than `mcpServers`. The new `Bundle` field is a plain `tools: { key; name; kind; inputSchema; requiresApproval; reversible }[]`.

---

### `packages/inngest/package.json` + `tsconfig.json` + `src/index.ts` (new workspace package)

**Analog:** `packages/vault/package.json` and `packages/vault/tsconfig.json`.

**Existing workspace package.json** (`packages/vault/package.json`):
```json
{
  "name": "@agent-os/vault",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsx src/vault.test.ts"
  },
  "dependencies": {
    "@agent-os/db": "workspace:*",
    "@agent-os/shared": "workspace:*",
    "drizzle-orm": "^0.45.2"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

**Existing tsconfig** (verbatim):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src"]
}
```

**Existing `src/index.ts` re-export pattern** (e.g. `packages/registry/src/index.ts`):
```typescript
export * from "./skills.js";
```

**Apply by:** copy the vault `package.json` verbatim, swap name to `@agent-os/inngest`, add `"inngest": "^4.5.0"` to dependencies and keep `@agent-os/db` + `drizzle-orm` (the `runScheduled` function inserts into `runs`). `tsconfig.json` is verbatim. `src/index.ts` re-exports `./client.js` and `./functions/runScheduled.js`. Same for `packages/tool-browser` — see below.

---

### `packages/inngest/src/functions/runScheduled.ts` (new — Inngest function)

**Analog:** `apps/scheduler/src/index.ts` `tick()` function (lines 17–22) — this is the closest "scheduled work creates `runs` rows" pattern.

**Existing scheduler tick** (apps/scheduler/src/index.ts lines 17–22):
```typescript
async function tick(db: ReturnType<typeof createDb>) {
  const created = await evaluateDueJobs(db, new Date());
  if (created.length > 0) {
    console.log(`[scheduler] materialized ${created.length} run(s): ${created.map((r) => r.runId).join(", ")}`);
  }
  return created.length;
}
```

**Apply by:** wrap the same DB-write logic in `inngest.createFunction({ id: 'aos-run-scheduled', retries: 3 }, { event: 'aos/agent.scheduled' }, async ({ event, step }) => { ... })`. Inside, use `step.run('insert-scheduled-run', async () => { const db = createDb(process.env.DATABASE_URL!); /* insert one runs row keyed by event.data.jobId */ })`. The work that pg_cron used to do inline (insert into `runs`) now runs here, retryable. **Reuse `createDb`** (same import as `apps/scheduler`).

---

### `apps/api/src/index.ts` (modified — Hono mount `/api/inngest`)

**Analog:** existing admin-route mounting pattern in the same file.

**Existing Hono `Variables` + middleware pattern** (lines 80–102):
```typescript
type Vars = { auth: ApiKeyContext };
const app = new Hono<{ Variables: Vars }>();

// --- Public ---
app.get("/health", (c) => c.json({ ok: true }));

// --- API key auth for everything else under /api ---
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/guide" || c.req.path === "/api/admin-guide") return next();
  // ...verify bearer key, set c.set("auth", auth)...
});

const requireAdmin = async (c, next) => {
  if (c.get("auth").kind !== "admin") return c.json({ error: "admin key required" }, 403);
  return next();
};
```

**Existing admin-scoped route** (line 387):
```typescript
app.post("/api/admin/architect/propose", requireAdmin, async (c) => { /* ... */ });
```

**Apply by:** `import { serve } from 'inngest/hono'; import { inngest, runScheduledAgent } from '@agent-os/inngest';` near the top. Mount the Inngest webhook handler BEFORE the `app.use("/api/*", ...)` API-key middleware (Inngest authenticates via its own signing key, NOT the project's API key auth — putting it under `/api/*` would 401 every Inngest webhook). Use a path the API-key middleware does NOT cover (either mount on `/inngest` or add `/api/inngest` to the path-skip allowlist in the middleware, same way `/api/guide` is skipped on line 90). The `inngest/hono` `serve()` handler verifies `INNGEST_SIGNING_KEY` automatically — DO NOT hand-roll HMAC (RESEARCH §Don't Hand-Roll).

---

### `packages/tool-browser/package.json` + `src/index.ts` + `src/types.ts` (new workspace package)

**Analog:** `packages/vault/package.json` (workspace shape — see Inngest pattern above).

**Apply by:** copy `packages/vault/package.json`, rename to `@agent-os/tool-browser`, dependencies = `{ "@browserbasehq/stagehand": "^3.4.0", "@browserbasehq/sdk": "^2.12.0", "zod": "^3" }` (zod already in repo — pin to existing version). No `@agent-os/db` dep — the tool handler is pure (input → external call → output). `tsconfig.json` and `src/index.ts` (re-export) match Inngest. `src/types.ts` defines zod schemas for tool input (`{ url: string; instruction: string; extractSchema?: z.ZodSchema }`).

---

### `packages/tool-browser/src/handler.ts` (new — Stagehand wrapper)

**Analog:** `packages/vault/src/index.ts` `storeCredential` (similar shape: external SDK wrap + DB-or-side-effect, but no DB here).

**Existing external-SDK wrap pattern** (`packages/vault/src/index.ts` lines 24–43):
```typescript
export async function storeCredential(db: Db, key: Buffer, args: StoreCredentialArgs) {
  const blob = encrypt(JSON.stringify({ access: args.accessToken, refresh: args.refreshToken } satisfies StoredTokens), key);
  await db.delete(oauthCredentials).where(...);
  const [row] = await db.insert(oauthCredentials).values({ ... }).returning();
  await db.update(mcps).set({ status: "connected", lastHealthCheck: new Date() }).where(eq(mcps.id, args.mcpId));
  return row;
}
```

**Apply by:** export `async function runBrowserTool(input: BrowserToolInput): Promise<{ sessionId; data }>`. **Mandatory try/finally** (RESEARCH §Pitfall 3):
```typescript
export async function runBrowserTool(input: BrowserToolInput) {
  const stagehand = new Stagehand({ env: 'BROWSERBASE', apiKey: process.env.BROWSERBASE_API_KEY!, projectId: process.env.BROWSERBASE_PROJECT_ID!, /* ... */ });
  try {
    await stagehand.init();
    // ...act/extract...
    return { sessionId: stagehand.sessionId, data };
  } finally {
    await stagehand.close();
  }
}
```

**SSRF guard** (RESEARCH §Pitfall — single most important security control): validate `input.url` against a denylist (block `169.254.0.0/16` metadata, `127.0.0.0/8` loopback, `10.0.0.0/8`, `192.168.0.0/16`, etc.) BEFORE constructing `Stagehand`. The denylist function is a new pure helper — no analog in the codebase yet; planner should make this its own task with a code-review depth bump.

---

### `apps/runner/src/execute.ts` (modified — `allowedTools` + custom-tool dispatch)

**Analog:** existing `liveRun` SDK setup in the same file (lines 109–164). Custom-tool dispatch has **no existing analog** — first time the runner registers a non-MCP tool with the SDK.

**Existing `liveRun` options block** (lines 117–137):
```typescript
const options: Record<string, unknown> = {
  model: b.agent.model,
  systemPrompt: buildSystemPrompt(b),
  permissionMode: permissionMode(b.autonomy),
  maxTurns: 12,
  // Safety hooks:
  hooks: {
    PreToolUse: [buildPreToolUseHook(api, runId, { autonomy: b.agent.autonomy, /* ... */ })],
    PostToolUse: [buildPostToolUseHook(api, runId)],
  },
};
if (b.run.sdkSessionId) options.resume = b.run.sdkSessionId;
```

**Apply by:**
1. Build `const allowedTools: string[] = [...b.mcpServers.map((m) => /* mcp tool names */), ...b.tools.map((t) => t.key)];` and add `options.allowedTools = allowedTools;`. **This is RESEARCH §Pitfall 5** — without explicit `allowedTools`, the SDK is wide-open and the registry adds no enforcement.
2. For `b.tools.filter((t) => t.kind === 'custom')`, register custom-tool handlers. The SDK's custom-tool registration shape (per RESEARCH) is `tools: { name, description, input_schema, handler }`. For `tool.browser`, the `handler` calls into `import('@agent-os/tool-browser').runBrowserTool(input)`. **Large outputs save to a file and return the path** (CLAUDE.md non-negotiable #4 + RESEARCH §3 step 4).
3. **PreToolUse/PostToolUse hooks are UNCHANGED.** The existing `buildPreToolUseHook` (apps/runner/src/hooks.ts lines 66–102) already reads `event.tool_name` and routes through `autonomyGate` — so `tool.browser` is gated by the existing `tools.requires_approval=true` default + autonomy rules. No new hook code.

**Existing PreToolUse hook that auto-gates the new tool** (apps/runner/src/hooks.ts lines 66–78):
```typescript
export function buildPreToolUseHook(api: ApiClient, runId: string, ctx: GateCtx) {
  return async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const toolName = String((event.tool_name as string | undefined) ?? (event.toolName as string | undefined) ?? "unknown");
    const decision = autonomyGate({ toolName, autonomy: ctx.autonomy, escalationPolicy: ctx.escalationPolicy });
    if (decision === "allow") return { decision: "allow" };
    // ...propose path raises approval + suspends...
  };
}
```

---

### `scripts/seed/acqu-tool-browser.ts` (new seed script)

**Analog:** `scripts/seed/acqu-vitals.ts` (canonical seed-one-thing pattern). All 26+ existing seeds follow this exact shape.

**Existing seed-script structure** (acqu-vitals.ts in full):
```typescript
import { createDb, schema } from "@agent-os/db";
import { seedAgent, type AgentSpec } from "@agent-os/core";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";
import { SKILL_SOURCE } from "./lib/runSpec.js";

const TENANT_ID = TENANT_IDS.acqu;

const SYSTEM_PROMPT = `...`;

export const vitalsSpec: AgentSpec = {
  tenantId: TENANT_ID,
  key: "vitals",
  // ...
  skills: [ /* ... */ ],
  mcpNames: [ /* ... */ ],
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  // ...seedAgent + console.log summary...
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

**Apply by:** the tool seed is simpler than an agent seed — it inserts ONE `tools` row (via the new `ensureTool` helper from `seedAgent.ts`). No `AgentSpec`, no system prompt; just `await ensureTool(db, TENANT_IDS.acqu, { key: 'tool.browser', name: 'Browser', kind: 'custom', inputSchema: BrowserToolInputSchema, requiresApproval: true, reversible: false })`. Per RESEARCH §Open Question 1, **do not bind to any agent yet** — the binding is deferred to whichever agent in Phase 8+ first uses it. Use the same `if (import.meta.url === ...) main()` guard + `process.exit` shape so the script is callable via the established `pnpm seed:tool-browser` pattern. Add the script to root `package.json` scripts if the project uses that pattern (check existing `pnpm seed:phase-1` references).

---

### `packages/core/src/integration.test.ts` (extended — P7-SC1.*)

**Analog:** the same file (extend in-place — do NOT create a new file; RESEARCH §Wave 0 Gaps explicitly says "reuse the existing tsx pattern").

**Existing test pattern** (lines 1–55):
```typescript
import { createDb, schema } from "@agent-os/db";
import { AGENT_IDS, TENANT_IDS } from "@agent-os/shared";
import { and, eq } from "drizzle-orm";
import { /* ... */ } from "./index.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDb(url);
  const tenantId = TENANT_IDS.acqu;

  console.log("\n[auth]");
  // ...assertions...
}
```

**Apply by:** append a new `console.log("\n[tools registry]")` section. Assert: (a) `ensureTool` round-trips a row; (b) re-running is idempotent; (c) `bindTool` + `agentTools` join populates `Bundle.tools[]`; (d) cross-tenant read on `tools` returns zero rows (mirror the existing cross-tenant assertions in `apps/api/src/app.test.ts` lines 50–56). No framework — `tsx` runs the file end-to-end and final `process.exit(failed ? 1 : 0)`.

---

### `apps/api/src/app.test.ts` (extended — `/api/inngest` introspection)

**Analog:** same file. Existing `app.request("/health")` introspection pattern (line 30) and admin-gating assertions (lines 56–58).

**Existing in-process request pattern** (line 30):
```typescript
assert((await app.request("/health")).status === 200, "GET /health is public");
```

**Apply by:** append `console.log("\n[inngest]")`; assert `await app.request("/api/inngest")` returns 200 (Inngest's introspection GET responds with function metadata). Then assert a POST without a valid signing key gets 401 in prod-config (or 200 in dev — gate on `INNGEST_DEV` env per RESEARCH §Pitfall 4).

---

## Shared Patterns

### RLS via `is_tenant_member()`
**Source:** `supabase/migrations/0001_init.sql` (function definition) + every migration since (0001, 0005, 0006).
**Apply to:** new `tools` table (top-level) + `agent_tools` join (via parent agent's tenant).
```sql
-- Top-level table:
alter table tools enable row level security;
create policy tools_rw on tools
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- Join table without its own tenant_id — authorize via parent:
alter table agent_tools enable row level security;
create policy agent_tools_rw on agent_tools
  using (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)))
  with check (exists (select 1 from agents a where a.id = agent_id and is_tenant_member(a.tenant_id)));
```

### Workspace package shape
**Source:** `packages/vault/package.json` + `packages/vault/tsconfig.json`.
**Apply to:** `packages/inngest`, `packages/tool-browser`.
Same `"type": "module"`, `"main": "./src/index.ts"`, `"exports": { ".": "./src/index.ts" }`, `tsx` test runner, `tsconfig.json` extending `../../tsconfig.base.json`. The project uses **TypeScript source as the package entry** (no build step for workspace packages); preserve this.

### Idempotent join-table insert with raw SQL
**Source:** `packages/core/src/seed/seedAgent.ts` lines 238–248 (`bindSkill`, `bindMcp`).
**Apply to:** new `bindTool` helper.
```typescript
await db.execute(
  sql`insert into agent_tools (agent_id, tool_id) values (${agentId}, ${toolId}) on conflict do nothing`,
);
```

### `tsx`-based test runner with `assert(cond, msg)` counter
**Source:** `packages/core/src/integration.test.ts` (header lines 28–35) — also used by `packages/vault/src/vault.test.ts` and `apps/api/src/app.test.ts`.
**Apply to:** every new test file in Phase 7 (`packages/inngest/src/inngest.test.ts`, `packages/tool-browser/src/tool-browser.test.ts`, `apps/runner/src/execute.test.ts`).
```typescript
let passed = 0, failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) (passed++, console.log(`  ✓ ${msg}`));
  else (failed++, console.error(`  ✗ ${msg}`));
}
```
Test file is invoked via `"test": "tsx src/<file>.test.ts"` in package.json.

### Seed script `main()` + import.meta guard
**Source:** `scripts/seed/acqu-vitals.ts` lines 54–96.
**Apply to:** `scripts/seed/acqu-tool-browser.ts`.
```typescript
async function main() { /* ... */ process.exit(0); }
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

### Hono admin-gated route
**Source:** `apps/api/src/index.ts` lines 99–102 (`requireAdmin`) + line 387 (usage).
**Apply to:** any future admin route on tools (not required in Phase 7, but reuse if added).

### External-SDK try/finally cleanup
**Source:** none precise in codebase yet — but enforced by CLAUDE.md non-negotiables. Pattern derives from RESEARCH §Pitfall 3 (Browserbase session leaks).
**Apply to:** every `runBrowserTool` invocation in `packages/tool-browser/src/handler.ts`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (custom-tool dispatch in `apps/runner/src/execute.ts`) | service | streaming | First time the runner registers a non-MCP `tools: [{ name, handler }]` array with the Claude Agent SDK. RESEARCH §3 step 2 says to follow the SDK's documented custom-tool registration shape; the planner should add a "verify `sdk.query` accepts `tools[].handler`" checkpoint as RESEARCH §Sources flags. |
| (SSRF URL denylist in `packages/tool-browser/src/handler.ts`) | utility | transform | No existing URL-validation helper in the codebase. Pure new code; reference doc is RESEARCH §Pitfall (SSRF) + Security Domain table. Add as its own task with code-review depth bump per RESEARCH §Metadata. |

## Metadata

**Analog search scope:** `supabase/migrations/`, `packages/db/src/`, `packages/core/src/`, `packages/core/src/seed/`, `packages/vault/`, `packages/registry/`, `apps/api/src/`, `apps/runner/src/`, `apps/scheduler/src/`, `scripts/seed/`.
**Files scanned:** ~25 (migrations 0001/0002/0005/0006, schema.ts, seedAgent.ts, bundle.ts, vault index/test/package.json/tsconfig, registry package.json/index.ts, apps/api index.ts/app.test.ts/package.json, apps/runner execute.ts/hooks.ts, apps/scheduler index.ts, scripts/seed acqu-vitals.ts + lib/runSpec.ts, packages/core integration.test.ts).
**Pattern extraction date:** 2026-05-30.
