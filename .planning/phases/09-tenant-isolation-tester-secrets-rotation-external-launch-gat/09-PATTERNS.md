# Phase 9: tenant-isolation-tester + secrets-rotation + access-auditor + security-anomaly-watchdog — Pattern Map

**Mapped:** 2026-05-31
**Files analyzed:** 19 (new/modified)
**Analogs found:** 19 / 19 (100%)

> Every new file in Phase 9 has a 1:1 in-repo analog. Phase 9 is composition over the substrate shipped in Phases 1, 5, 7, 8, 8.5 — not greenfield. The planner should reference the analog file + line range; do not invent shapes.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/seed/acqu-tenant-isolation-tester.ts` | seed (agent-as-data, T-critical) | config / write-once | `scripts/seed/acqu-ad-claim-compliance.ts` | **exact** (both T-critical, same `runStandalone` shape) |
| `scripts/seed/acqu-secrets-rotation.ts` | seed (agent-as-data, T-critical) | config / write-once | `scripts/seed/acqu-contract-drafter.ts` | **exact** |
| `scripts/seed/acqu-access-auditor.ts` | seed (agent-as-data, T-critical) | config / write-once | `scripts/seed/acqu-ad-claim-compliance.ts` | **exact** |
| `scripts/seed/acqu-security-anomaly-watchdog.ts` | seed (agent-as-data, T-critical) | config / write-once | `scripts/seed/acqu-ad-claim-compliance.ts` | **exact** |
| `scripts/seed/seed-phase-9.ts` | batch runner (with hard-fail guard) | batch / write | `scripts/seed/seed-phase-4.ts` | **exact** (re-use the T-critical assertion loop) |
| `scripts/seed/acqu-tool-rls-test.ts` | seed (tool registry row) | config / write-once | `scripts/seed/acqu-tool-browser.ts` | **exact** |
| `scripts/seed/acqu-tool-vault-rotate.ts` | seed (tool registry row) | config / write-once | `scripts/seed/acqu-tool-browser.ts` | **exact** |
| `scripts/seed/acqu-tool-access-audit.ts` | seed (tool registry row) | config / write-once | `scripts/seed/acqu-tool-browser.ts` | **exact** |
| `scripts/seed/acqu-tool-access-log-analyzer.ts` | seed (tool registry row) | config / write-once | `scripts/seed/acqu-tool-browser.ts` | **exact** |
| `supabase/migrations/0010_security_findings.sql` | migration (DDL + RLS) | schema | `supabase/migrations/0006_architect_blueprints.sql` | **exact** (tenant-scoped + `is_tenant_member()` + jsonb payload + `updated_at` trigger) |
| `packages/tool-rls-test/package.json` | workspace manifest | config | `packages/tool-browser/package.json` | **exact** (mirror name → `@agent-os/tool-rls-test`) |
| `packages/tool-rls-test/tsconfig.json` | workspace tsconfig | config | `packages/tool-browser/tsconfig.json` | **exact** (copy verbatim) |
| `packages/tool-rls-test/src/index.ts` | runtime tool (entry) | request-response (one-shot per dispatch) | `packages/tool-browser/src/index.ts` | **exact** (validate → guard → run → return) |
| `packages/tool-rls-test/src/types.ts` | zod input/output schema | type | `packages/tool-browser/src/types.ts` | **exact** |
| `packages/tool-rls-test/src/impersonate.ts` | DB helper (tenant impersonation via GUC) | request-response (txn-scoped) | `packages/vault/src/index.ts` `resolveAccessToken` (lines 54-87, txn pattern + drizzle `db.transaction`) | role-match (DB-helper shape; uses 0001_init.sql `auth.uid()` GUC verbatim from lines 36-40) |
| `packages/tool-rls-test/src/attack-vectors.ts` | append-only frozen registry | const-array | `packages/core/src/architect/hydrate.ts` `CANT_FAIL_KEYS` (lines 21-35, frozen-set pattern) | role-match |
| `packages/tool-rls-test/src/tool-rls-test.test.ts` | tsx test | test | `packages/tool-browser/src/tool-browser.test.ts` | **exact** (no vitest; bespoke `assert` + main()) |
| `packages/core/src/security/vault-rotate.ts` | core module (DB + provider effect) | CRUD + external call | `packages/vault/src/index.ts` `resolveAccessToken` (lines 54-87) | **exact** (decrypt → refresher → storeCredential — the rotation IS resolveAccessToken on the eager path) |
| `packages/core/src/security/access-audit.ts` | core module (read-only SQL) | query / aggregation | `packages/core/src/lifecycle.ts` (drizzle/raw `sql` pattern + tenant-scoped queries) | role-match |
| `packages/core/src/security/anomaly.ts` | core module (windowed scan) | query / aggregation | `packages/core/src/lifecycle.ts` `recordAutonomyEvent` consumers (autonomyEvents + auditLog reads) | role-match |
| `packages/core/src/security/findings.ts` | core module (insert helper) | CRUD (write-only) | `packages/core/src/lifecycle.ts` `appendActivity` (lines 56-62) | **exact** |
| `packages/core/src/security/*.test.ts` (×3 or ×4) | tsx test | test | `packages/tool-browser/src/tool-browser.test.ts` | **exact** |
| `apps/runner/src/custom-tools.ts` | **MODIFIED** — register 3-4 handlers | dispatch map | itself (lines 28-35) | self-extension (add map entries) |
| `packages/core/src/architect/architect.test.ts` | **MODIFIED** — extend can't-fail assertions | test | itself (lines 153-183) | self-extension (all 4 keys already in `CANT_FAIL_KEYS`; just assert) |
| `docs/acqu-phase-9-agent-manifest.md` | operator manifest | docs | `docs/acqu-phase-4-agent-manifest.md` | **exact** (hard-gate callout for the 4 T-critical) |
| `external/acqu-skills/*/SKILL.md` (×4 stubs) | skill markdown | docs | (existing `external/acqu-skills/<name>/SKILL.md` — same format used by Phase 1-8) | exact |
| `scripts/verify/isolation-live.ts` | live verification script | one-shot CLI | `scripts/seed/seed-phase-4.ts` (top-level main + exit codes) + `apps/runner/src/browser-smoke.ts` shape | role-match |

---

## Pattern Assignments

### `scripts/seed/acqu-tenant-isolation-tester.ts` (seed, T-critical)
### `scripts/seed/acqu-secrets-rotation.ts` (seed, T-critical)
### `scripts/seed/acqu-access-auditor.ts` (seed, T-critical)
### `scripts/seed/acqu-security-anomaly-watchdog.ts` (seed, T-critical)

**Analog:** `scripts/seed/acqu-ad-claim-compliance.ts` (53 lines — read in full).

These four seeds are **structurally identical** — the only deltas are `key`, `name`, `SYSTEM_PROMPT`, `cron`, `tools`, `budgetCapUsd`, and `escalationPolicy`. Copy the analog verbatim; change those six fields.

**Imports pattern** (lines 5-7 of analog):
```typescript
import { TENANT_IDS } from "@agent-os/shared";
import { runStandalone } from "./lib/runSpec.js";
import type { AgentSpec } from "@agent-os/core";
```

**T-critical header comment** (lines 1-4 of analog — REQUIRED for audit grep):
```typescript
// scripts/seed/acqu-<key>.ts
// Source: v2 §D5.3 · main §1.5 + CLAUDE.md can't-fail list.
// HARD GATE #2 (main §6): no external Cliently launch until tenant-isolation-tester passes.
// Model MUST be claude-opus-4.8 — NEVER Hermes.
```

**Spec literal** (lines 31-50 of analog — copy structure verbatim):
```typescript
export const tenantIsolationTesterSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "tenant-isolation-tester",
  name: "Tenant Isolation Tester",
  systemPrompt: SYSTEM_PROMPT,
  // T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
  model: "anthropic/claude-opus-4.8",
  thinkingLevel: "high",
  autonomy: "execute_safe",                          // doctrine D5.3 — alerts only
  knowledgeScope: { folders: ["security"], tags: ["security"] },
  budgetCapUsd: "1.50",
  cron: { schedule: "30 4 * * *", jobName: "tenant-isolation-tester-daily" },
  tools: [{ key: "tool.rls-test", name: "RLS Test Suite", kind: "custom", requiresApproval: false }],
  skills: [
    { key: "tenant-isolation-testing", name: "Tenant Isolation Testing" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
  escalationPolicy: "tcritical:isolation_failure -> founder_p0",
};
```

**Entry point** (line 52 of analog — `runStandalone`, **always last line**):
```typescript
if (import.meta.url === `file://${process.argv[1]}`) void runStandalone(tenantIsolationTesterSpec);
```

**Per-agent deltas table** (planner reference):

| Agent | autonomy | cron | budget | tools[].key | escalationPolicy |
|---|---|---|---|---|---|
| `tenant-isolation-tester` | `execute_safe` | `30 4 * * *` | `1.50` | `tool.rls-test` | `tcritical:isolation_failure -> founder_p0` |
| `secrets-rotation` | `execute_safe` (internal) / `propose` posture for client OAuth — enforced in tool, not spec | `0 4 * * *` | `0.50` | `tool.vault-rotate` | `tcritical:rotation_failed -> founder_p0` |
| `access-auditor` | `execute_safe` | `0 5 * * 3` (Wed 05:00 per v2 D5.3 L1269) | `1.00` | `tool.access-audit` | `tcritical:orphan_grant -> founder_p1` |
| `security-anomaly-watchdog` | `execute_safe` (D-07: alerts only, never blocks) | `0 * * * *` (hourly) | `0.30` | `tool.access-log-analyzer` | `tcritical:anomaly_high -> founder_p0` |

---

### `scripts/seed/seed-phase-9.ts` (batch runner)

**Analog:** `scripts/seed/seed-phase-4.ts` (149 lines — read in full).

**Critical pattern to replicate — hard-fail guard before DB writes** (lines 60-81 of analog):

```typescript
// Sanity: ALL 4 of these MUST resolve to claude-opus-4.8 (CLAUDE.md can't-fail list).
const T_CRITICAL_KEYS = new Set([
  "tenant-isolation-tester",
  "secrets-rotation",
  "access-auditor",
  "security-anomaly-watchdog",
]);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  // Hard-fail BEFORE touching the DB if any T-critical agent's spec was tampered with.
  for (const spec of PHASE_9) {
    if (T_CRITICAL_KEYS.has(spec.key) && spec.model !== "anthropic/claude-opus-4.8") {
      throw new Error(
        `HARD FAIL: ${spec.key} is T-critical (CLAUDE.md can't-fail list) but model=${spec.model}. Must be anthropic/claude-opus-4.8.`,
      );
    }
  }
  // ...
}
```

> Note: every Phase-9 agent is T-critical (all 4 are on CLAUDE.md's can't-fail list), so `T_CRITICAL_KEYS` has the same 4 entries as `PHASE_9`. The guard MUST still iterate — `seedAgent` will rewrite via `tenants.default_model_override` (Phase 8.5), and the hard-fail catches script-literal tampering BEFORE the override step.

**Eyeball table pattern** (lines 86-132 of analog) — copy verbatim with `padEnd` column widths.

**Closing summary** (lines 134-141 of analog) — change "Next:" line to the live-verification handoff:
```typescript
console.log("HARD GATE #2 (main §6): RUN `pnpm verify:isolation-live` against a 2-tenant Supabase before Phase 10.");
```

---

### `scripts/seed/acqu-tool-rls-test.ts` (and 3 sibling tool seeds)

**Analog:** `scripts/seed/acqu-tool-browser.ts` (55 lines — read in full).

**Imports + INPUT_SCHEMA pattern** (lines 8-25 of analog):
```typescript
import { createDb, schema } from "@agent-os/db";
import { ensureTool } from "@agent-os/core";
import { TENANT_IDS } from "@agent-os/shared";
import { eq } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;

// Hand-written JSON Schema — mirrors packages/tool-rls-test/src/types.ts
const INPUT_SCHEMA = {
  type: "object",
  properties: {
    tenantPairs: { type: "array", items: { type: "object" } },
    tables: { type: "array", items: { type: "string" } },
  },
  required: ["tenantPairs"],
} as const;
```

**ensureTool call** (lines 27-45 of analog):
```typescript
export async function seedToolRlsTest() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const tool = await ensureTool(db, TENANT_ID, {
    key: "tool.rls-test",
    name: "RLS Test Suite",
    kind: "custom",
    description: "Cross-tenant query attack suite (positive + negative controls; appendable vector registry)",
    inputSchema: INPUT_SCHEMA,
    requiresApproval: false,   // read-only — no mutations
    reversible: true,
  });
  // ... verify + log
}
```

**Per-tool deltas:**

| key | name | kind | requiresApproval | reversible | description |
|---|---|---|---|---|---|
| `tool.rls-test` | RLS Test Suite | custom | `false` | `true` | Cross-tenant query attack (read-only) |
| `tool.vault-rotate` | Vault Rotate | custom | **`true`** | `false` | Client OAuth rotation is propose-gated per v2 D5.3 L1254 |
| `tool.access-audit` | Access Audit | custom | `false` | `true` | Read-only grants inventory |
| `tool.access-log-analyzer` | Access Log Analyzer | custom | `false` | `true` | Read-only anomaly scan |

---

### `supabase/migrations/0010_security_findings.sql`

**Analog:** `supabase/migrations/0006_architect_blueprints.sql` (49 lines — read in full).

**Full skeleton to copy** (lines 5-48 of analog):

```sql
-- 0010_security_findings.sql
-- Security findings — durable storage for isolation tests, rotation events,
-- orphan flags, anomaly detections (Phase 9 hard gate #2 substrate).

create table if not exists security_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,    -- which agent raised it
  category text not null check (category in ('isolation','rotation','access','anomaly')),
  severity text not null check (severity in ('low','medium','high','critical')),
  status   text not null default 'open' check (status in ('open','acknowledged','resolved','suppressed')),
  title    text not null,
  payload  jsonb not null default '{}'::jsonb,
  -- D-08: positive control proof is part of the payload — don't model as a separate column
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists security_findings_tenant_status_idx
  on security_findings (tenant_id, status, severity, detected_at desc);

-- Pitfall 3 mitigation — add audit_log time index if not already present.
create index if not exists audit_log_tenant_ts_idx
  on audit_log (tenant_id, ts desc);

alter table security_findings enable row level security;

-- Same shape as every tenant-scoped table — authorize via is_tenant_member().
-- See 0001_init.sql lines 74-80 for the function definition.
create policy security_findings_rw on security_findings
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- Trigger to keep updated_at fresh on any UPDATE.
create or replace function security_findings_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists security_findings_touch on security_findings;
create trigger security_findings_touch
  before update on security_findings
  for each row execute function security_findings_touch_updated_at();
```

---

### `packages/tool-rls-test/package.json`

**Analog:** `packages/tool-browser/package.json` (21 lines — read in full).

```json
{
  "name": "@agent-os/tool-rls-test",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsx src/tool-rls-test.test.ts"
  },
  "dependencies": {
    "@agent-os/db": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

> Delta from analog: adds `@agent-os/db` + `drizzle-orm` deps because the tool runs SQL against a tenant-impersonating connection.

**`tsconfig.json`:** copy `packages/tool-browser/tsconfig.json` verbatim (9 lines, no edits).

---

### `packages/tool-rls-test/src/index.ts`

**Analog:** `packages/tool-browser/src/index.ts` (55 lines — read in full).

**Shape to copy** (lines 13-55 of analog — validate → guard → run → return):
```typescript
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IsolationInputSchema, type IsolationInput, type IsolationResult } from "./types.js";
import { ATTACK_VECTORS, assertVectorsAppendOnly } from "./attack-vectors.js";
import { asUser } from "./impersonate.js";

export * from "./types.js";
export * from "./impersonate.js";
export * from "./attack-vectors.js";

export async function runIsolationSuite(
  input: IsolationInput,
  opts?: { outputDir?: string; db?: Db },
): Promise<IsolationResult> {
  const parsed = IsolationInputSchema.parse(input);            // 1. validate
  assertVectorsAppendOnly();                                    // 2. guard: registry didn't shrink
  const outDir = opts?.outputDir ?? (await mkdtemp(join(tmpdir(), "tool-rls-test-")));

  // 3. run each vector; large outputs (per-vector traces) -> file
  const results = [];
  for (const v of ATTACK_VECTORS) results.push(await v.run(opts!.db!, parsed));
  const resultsPath = join(outDir, "results.json");
  await writeFile(resultsPath, JSON.stringify(results, null, 2), "utf8");

  // 4. return paths, never blobs (CLAUDE.md non-negotiable #4)
  return { resultsPath, passed: results.every((r) => r.passed), count: results.length };
}
```

---

### `packages/tool-rls-test/src/types.ts`

**Analog:** `packages/tool-browser/src/types.ts` (24 lines — read in full).

**zod schema pattern:**
```typescript
import { z } from "zod";

export const IsolationInputSchema = z.object({
  tenantPairs: z.array(z.object({ userA: z.string().uuid(), userB: z.string().uuid(), tenantA: z.string().uuid(), tenantB: z.string().uuid() })).min(1),
  tables: z.array(z.string()).optional(),     // defaults to ALL tenant-scoped tables in attack-vectors.ts
});
export type IsolationInput = z.infer<typeof IsolationInputSchema>;

export interface IsolationResult {
  resultsPath: string;
  passed: boolean;
  count: number;
}
```

---

### `packages/tool-rls-test/src/impersonate.ts`

**Analog:** `supabase/migrations/0001_init.sql` lines 36-40 (the `auth.uid()` GUC reader — copy the GUC name verbatim) + `packages/vault/src/index.ts` `resolveAccessToken` lines 54-87 (drizzle txn pattern).

**Verbatim from RESEARCH §Architecture Pattern 1:**
```typescript
import type { Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

/** Run `fn` with auth.uid() bound to `userId` for this txn. Resets on commit/rollback.
 *  GUC name comes from supabase/migrations/0001_init.sql line 39 — DO NOT rename. */
export async function asUser<T>(db: Db, userId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${userId}, true)`);
    return fn();
  });
}
```

---

### `packages/tool-rls-test/src/attack-vectors.ts`

**Analog:** `packages/core/src/architect/hydrate.ts` `CANT_FAIL_KEYS` (lines 21-35 — frozen Set pattern) for the append-only guarantee, plus the per-test pattern from RESEARCH §Code Examples (positive control + attack).

**Append-only guard pattern** (mirrors `CANT_FAIL_KEYS`):
```typescript
export const ATTACK_VECTORS = Object.freeze([
  { id: "AV-001", name: "tenant_isolation:tenants", run: testTenantsTable },
  { id: "AV-002", name: "tenant_isolation:agents", run: testAgentsTable },
  // ...one entry per RLS-protected table from 0001_init.sql line 414-419 + 0006/0007/0008/0009/0010
  // EVERY FIXED BUG = NEW FROZEN ENTRY. PRs that delete entries fail CI.
]);

const REGISTERED_COUNT_FLOOR = ATTACK_VECTORS.length;
export function assertVectorsAppendOnly() {
  if (ATTACK_VECTORS.length < REGISTERED_COUNT_FLOOR) throw new Error(...);
}
```

**Per-vector test pattern (positive control + attack — Pitfall 5):**
```typescript
import { asUser } from "./impersonate.js";
import { sql } from "drizzle-orm";

export async function testTenantsTable(db: Db, ctx: IsolationInput) {
  const { userA, userB, tenantB } = ctx.tenantPairs[0]!;

  // Positive control — proves the test is wired (Pitfall 5):
  const posCtl = await asUser(db, userB, () =>
    db.execute(sql`select id from tenants where id = ${tenantB}`)
  );
  if (posCtl.length !== 1) throw new Error("AV-001 wiring broken: tenant B can't see itself");

  // Attack: tenant A reads tenant B's row.
  const attack = await asUser(db, userA, () =>
    db.execute(sql`select id from tenants where id = ${tenantB}`)
  );
  return { id: "AV-001", table: "tenants", passed: attack.length === 0, actual: attack.length, expected: 0 };
}
```

---

### `packages/tool-rls-test/src/tool-rls-test.test.ts`

**Analog:** `packages/tool-browser/src/tool-browser.test.ts` (77 lines — read in full).

**Test harness pattern** (lines 7-42 of analog — copy the `assert` + counters + main()):
```typescript
let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

async function main() {
  console.log("• zod input validation");
  assert(IsolationInputSchema.safeParse({ tenantPairs: [...] }).success, "accepts valid input");
  assert(!IsolationInputSchema.safeParse({}).success, "rejects empty input");

  console.log("• append-only guard");
  assert(ATTACK_VECTORS.length >= 1, "vector registry non-empty");
  // Note: testing the actual attack vectors requires a live DB w/ 2 tenants seeded — that
  // lives in scripts/verify/isolation-live.ts (SC-9-1.b), not here.

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

---

### `packages/core/src/security/vault-rotate.ts`

**Analog:** `packages/vault/src/index.ts` `resolveAccessToken` lines 54-87 (the rotation is the eager-path equivalent of resolveAccessToken's lazy-refresh branch).

**Core pattern to copy** (lines 67-79 of analog — refresh + storeCredential):
```typescript
import { resolveAccessToken, storeCredential, decrypt, type Refresher } from "@agent-os/vault";
import { schema, type Db } from "@agent-os/db";
import { and, eq } from "drizzle-orm";
import { recordFinding } from "./findings.js";

const { oauthCredentials } = schema;

export interface RotateResult { rotated: boolean; reason?: string }

export async function rotateCredential(
  db: Db, key: Buffer, mcpId: string, refresher: Refresher,
): Promise<RotateResult> {
  const [cred] = await db.select().from(oauthCredentials).where(eq(oauthCredentials.mcpId, mcpId));
  if (!cred?.expiresAt) return { rotated: false, reason: "no expiry — manual provider rotation required" };
  const tokens = JSON.parse(decrypt(cred.vaultRef, key));
  if (!tokens.refresh) return { rotated: false, reason: "no refresh token — needs_reauth flow" };
  const fresh = await refresher(tokens.refresh);
  if (!fresh) {
    await recordFinding(db, { tenantId: cred.tenantId, category: "rotation", severity: "high",
      title: `rotation failed for mcp ${mcpId}`, payload: { mcpId } });
    return { rotated: false, reason: "provider refresh failed" };
  }
  await storeCredential(db, key, {
    tenantId: cred.tenantId, mcpId,
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken ?? tokens.refresh,
    scopes: cred.scopes,
    expiresAt: fresh.expiresAt ?? null,
  });
  return { rotated: true };
}
```

**Refresher stub pattern (D-03 — Close = reference, Meta/Stripe = stub):**
```typescript
export const stubRefresher: Refresher = async () => {
  throw new Error("operator: implement provider refresher (see docs/HANDOFF-other-session.md)");
};
```

---

### `packages/core/src/security/access-audit.ts`

**Analog:** `packages/core/src/lifecycle.ts` (drizzle `sql` + tenant-scoped read pattern) + RESEARCH §Code Examples.

**Imports + tenant-scoped query pattern:**
```typescript
import { sql } from "drizzle-orm";
import { type Db } from "@agent-os/db";

// Pitfall 4: archived agents keep bindings deliberately (Phase 8.5). Only flag
// archived-with-high-privilege OR archived>30d-with-active-grants.
export async function findOrphanedGrants(db: Db, tenantId: string) {
  return db.execute(sql`
    select oc.id as cred_id, oc.mcp_id, m.name as mcp_name,
           a.key as agent_key, a.lifecycle_state, a.lifecycle_changed_at
    from oauth_credentials oc
    join agent_mcps am on am.mcp_id = oc.mcp_id
    join agents a on a.id = am.agent_id
    join mcps m on m.id = oc.mcp_id
    where oc.tenant_id = ${tenantId}
      and a.lifecycle_state = 'archived'
      and a.lifecycle_changed_at < now() - interval '30 days'
  `);
}
```

---

### `packages/core/src/security/anomaly.ts`

**Analog:** `packages/core/src/lifecycle.ts` `recordAutonomyEvent` (line 125+) — the writer side of the data this module reads.

**Windowed scan pattern (Pitfall 3 — 24h rolling, not full history):**
```typescript
import { sql } from "drizzle-orm";
import { type Db } from "@agent-os/db";

export async function detectUsageSpikes(db: Db, tenantId: string, window: { hours: number } = { hours: 24 }) {
  return db.execute(sql`
    with current_window as (
      select tool_name, count(*) as n
      from audit_log
      where tenant_id = ${tenantId}
        and ts > now() - (${window.hours} || ' hours')::interval
      group by tool_name
    ),
    baseline as (
      select tool_name, count(*)::float / 7 as daily_avg
      from audit_log
      where tenant_id = ${tenantId}
        and ts between now() - interval '8 days' and now() - interval '1 day'
      group by tool_name
    )
    select c.tool_name, c.n, b.daily_avg, c.n / nullif(b.daily_avg, 0) as ratio
    from current_window c left join baseline b using (tool_name)
    where c.n > 10 and (b.daily_avg is null or c.n / nullif(b.daily_avg, 0) > 5)
  `);
}
```

---

### `packages/core/src/security/findings.ts`

**Analog:** `packages/core/src/lifecycle.ts` `appendActivity` lines 56-62 (single-table insert helper).

**Copy shape verbatim:**
```typescript
import { type Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

export interface FindingArgs {
  tenantId: string;
  agentId?: string | null;
  category: "isolation" | "rotation" | "access" | "anomaly";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  payload?: Record<string, unknown>;
}

export async function recordFinding(db: Db, args: FindingArgs) {
  const [row] = await db.execute(sql`
    insert into security_findings (tenant_id, agent_id, category, severity, title, payload)
    values (${args.tenantId}, ${args.agentId ?? null}, ${args.category}, ${args.severity}, ${args.title}, ${JSON.stringify(args.payload ?? {})}::jsonb)
    returning *
  `);
  return row;
}
```

---

### `apps/runner/src/custom-tools.ts` (MODIFIED)

**Analog:** itself, lines 28-35. Add new entries to the existing dispatch map.

**Existing pattern** (lines 28-35 — copy structure for new entries):
```typescript
import { runIsolationSuite, type IsolationInput, type IsolationResult } from "@agent-os/tool-rls-test";
import { rotateCredential } from "@agent-os/core";   // re-exported from packages/core/src/index.ts
import { findOrphanedGrants } from "@agent-os/core";
import { detectUsageSpikes } from "@agent-os/core";

export const customToolDispatch: Record<string, CustomToolHandler> = {
  "tool.browser": async (input, ctx) => { /* existing — unchanged */ },
  "tool.rls-test": async (input, ctx) => {
    const result: IsolationResult = await runIsolationSuite(input as IsolationInput, { outputDir: ctx.outputDir });
    return { result };
  },
  "tool.vault-rotate": async (input, ctx) => {
    // input: { mcpId } — refresher must be wired by provider (D-03)
    const result = await rotateCredential(/* ... */);
    return { result };
  },
  "tool.access-audit": async (input, ctx) => {
    const result = await findOrphanedGrants(/* ... */);
    return { result };
  },
  "tool.access-log-analyzer": async (input, ctx) => {
    const result = await detectUsageSpikes(/* ... */);
    return { result };
  },
};
```

> The `dispatchCustomTool` wrapper (lines 47-65) already writes results to `${tmpDir}/${toolKey}-result.json` — no changes needed. CLAUDE.md non-negotiable #4 is honored for free.

---

### `packages/core/src/architect/architect.test.ts` (MODIFIED)

**Analog:** itself, lines 153-183 — already exercises `ad-claim-compliance`. The 4 Phase-9 keys are **already in `CANT_FAIL_KEYS`** (`packages/core/src/architect/hydrate.ts` lines 23-25, 33). All that's needed is **assertions** to lock the regression.

**Pattern to extend** (lines 182-183 of analog):
```typescript
// Phase 9 — add can't-fail regression locks for the 4 security agents.
assert(isCantFail("tenant-isolation-tester"), "isCantFail recognizes tenant-isolation-tester");
assert(isCantFail("secrets-rotation"), "isCantFail recognizes secrets-rotation");
assert(isCantFail("access-auditor"), "isCantFail recognizes access-auditor");
assert(isCantFail("security-anomaly-watchdog"), "isCantFail recognizes security-anomaly-watchdog");
```

> Note: `secrets-rotation` is NOT in the current `CANT_FAIL_KEYS` set (lines 21-35 of `hydrate.ts`). Planner MUST add it there as part of this phase OR the test will fail. The other 3 are already present.

---

### `docs/acqu-phase-9-agent-manifest.md`

**Analog:** `docs/acqu-phase-4-agent-manifest.md` (77 lines — read in full).

**Sections to copy verbatim (rename Phase-4 → Phase-9):**
- Precedence banner (line 3)
- "Hard tier lock — N T-critical agents" callout (lines 7-19) — **all 4 of Phase 9's agents are T-critical**, vs. 7/22 in Phase 4
- Roster table (lines 21-51) — Phase 9 has 4 rows
- Tier overrides vs. doctrine (lines 53-60) — Phase 9 docstring should note the Hermes-vs-Opus tradeoff from D-04
- How to run (lines 62-68)
- B-phase verification entry point (lines 70-76) — REPLACE with the hard-gate verification: `pnpm verify:isolation-live` against 2 tenants

**New section to add (specific to Phase 9 — not in Phase 4 manifest):**
```markdown
## HARD GATE #2 — External launch block

Per main §6: no external Cliently launch until `tool.rls-test` runs against live Supabase with ≥2 tenants and reports ZERO cross-tenant leaks.

Pass criteria: `pnpm verify:isolation-live` exits 0 with `passed: true, leaks: 0` AND every positive control returns ≥1 row.
```

---

### `scripts/verify/isolation-live.ts`

**Analog:** `scripts/seed/seed-phase-4.ts` for top-level main + DB connect + exit codes; `apps/runner/src/browser-smoke.ts` for the "real-side-effect smoke script" shape.

**Sketch:**
```typescript
// scripts/verify/isolation-live.ts
// Hard-gate verification — run after seed-phase-9 against live Supabase with 2+ tenants.
import { createDb } from "@agent-os/db";
import { runIsolationSuite } from "@agent-os/tool-rls-test";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (!process.env.RLS_TEST_DATABASE_URL) throw new Error("RLS_TEST_DATABASE_URL required (D-01 — non-service-role)");
  const db = createDb(process.env.RLS_TEST_DATABASE_URL);

  // Resolve 2 tenants + 1 user each (must be pre-seeded).
  // ... (per-row pairs from TENANT_IDS.acqu + TENANT_IDS.cliently)

  const result = await runIsolationSuite({ tenantPairs: [...] }, { db });
  console.log(`\nHARD GATE: passed=${result.passed} count=${result.count} resultsPath=${result.resultsPath}`);
  if (!result.passed) {
    console.error("HARD GATE FAILED — external Cliently launch blocked per main §6.");
    process.exit(1);
  }
  console.log("HARD GATE PASSED — Phase 10 unblocked.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

---

### `external/acqu-skills/*/SKILL.md` (4 stubs)

**Analog:** any existing `external/acqu-skills/<name>/SKILL.md` referenced by Phase 1-8 seeds (e.g. `verification-before-completion`).

**Stubs to create:**
- `external/acqu-skills/tenant-isolation-testing/SKILL.md`
- `external/acqu-skills/secrets-rotation/SKILL.md`
- `external/acqu-skills/access-audit/SKILL.md`
- `external/acqu-skills/anomaly-detection-security/SKILL.md`

Each contains the doctrine procedure from v2 §D5.3 sub-section for that agent, with the section header `# SKILL: <name>` + a `## Purpose` + `## Workflow` + `## Rules`.

---

## Shared Patterns

### Pattern S1 — T-critical model literal lock
**Source:** `scripts/seed/acqu-ad-claim-compliance.ts` lines 36-37; `scripts/seed/seed-phase-4.ts` lines 60-81.
**Apply to:** All 4 Phase-9 agent seeds + the `seed-phase-9.ts` batch runner.

```typescript
// In each per-agent file:
// T-CRITICAL — Claude Opus 4.8 per CLAUDE.md can't-fail list. NEVER change to Hermes.
model: "anthropic/claude-opus-4.8",

// In seed-phase-9.ts:
if (T_CRITICAL_KEYS.has(spec.key) && spec.model !== "anthropic/claude-opus-4.8") {
  throw new Error(`HARD FAIL: ${spec.key} is T-critical ...`);
}
```

### Pattern S2 — Tenant-scoped RLS migration
**Source:** `supabase/migrations/0006_architect_blueprints.sql` lines 28-34 (combined with `0001_init.sql` lines 74-80 for the `is_tenant_member()` definition).
**Apply to:** `0010_security_findings.sql` (the only new migration).

```sql
alter table <new_table> enable row level security;
create policy <new_table>_rw on <new_table>
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
```

### Pattern S3 — `updated_at` touch trigger
**Source:** `supabase/migrations/0006_architect_blueprints.sql` lines 37-48.
**Apply to:** Every mutable row in `security_findings` (status can flip from `open` → `acknowledged` → `resolved`).

### Pattern S4 — Idempotent agent seed (DB-side override aware)
**Source:** `packages/core/src/seed/seedAgent.ts` lines 353-429 — the `seedAgent` helper already handles the tenant `default_model_override` rewrite (lines 372-384) with the warning. Per-agent seed scripts do NOT need to read the override themselves — `runStandalone` → `runSpec` → `seedAgent` does it.
**Apply to:** All 4 per-agent seeds.

### Pattern S5 — tsx-only test (no vitest)
**Source:** `packages/tool-browser/src/tool-browser.test.ts` lines 7-77.
**Apply to:** All 4 new test files (`tool-rls-test.test.ts`, 3× `packages/core/src/security/*.test.ts`).

```typescript
// package.json:  "test": "tsx src/<name>.test.ts"
// test file: counters + assert(cond, msg) + main() + process.exit(failed > 0 ? 1 : 0)
```

### Pattern S6 — Custom tool dispatcher signature
**Source:** `apps/runner/src/custom-tools.ts` lines 23-35.
**Apply to:** All 4 new entries in the dispatch map. The `dispatchCustomTool` wrapper (lines 47-65) handles tmpdir + file write — handler returns `{ result }`, framework persists.

### Pattern S7 — Tool registry seed (`ensureTool` + JSON Schema)
**Source:** `scripts/seed/acqu-tool-browser.ts` lines 17-45.
**Apply to:** All 4 new tool seeds. Hand-write the JSON Schema mirroring each tool's zod input (no zod-to-json-schema dep).

### Pattern S8 — Add tool to `package.json` scripts + batch wrapper
**Source:** `scripts/seed/seed-tool-browser.ts` lines 1-17; `scripts/seed/package.json` line 40.
**Apply to:** Add `pnpm seed:tool-rls-test`, `seed:tool-vault-rotate`, `seed:tool-access-audit`, `seed:tool-access-log-analyzer` entries; the batch `seed-phase-9.ts` calls them BEFORE seeding agents (tools must exist before agent bindings).

---

## No Analog Found

| File | Reason |
|---|---|
| (none) | Every new file maps to an in-repo analog. Phase 9 is composition, not greenfield. |

---

## Metadata

**Analog search scope:**
- `/home/user/agent-os/scripts/seed/` (40+ existing seeds)
- `/home/user/agent-os/packages/{core,vault,tool-browser,db,shared}/src/`
- `/home/user/agent-os/supabase/migrations/0001` through `0009`
- `/home/user/agent-os/apps/runner/src/`
- `/home/user/agent-os/docs/acqu-phase-{1,2,3,4}-agent-manifest.md`

**Files scanned:** 18 (Read in full or targeted ranges)

**Pattern extraction date:** 2026-05-31

**Key files for planner to keep open during planning:**
1. `scripts/seed/acqu-ad-claim-compliance.ts` — the per-agent template
2. `scripts/seed/seed-phase-4.ts` — the batch runner with the hard-fail guard
3. `scripts/seed/acqu-tool-browser.ts` — the per-tool seed template
4. `packages/tool-browser/{package.json,tsconfig.json,src/index.ts,src/types.ts,src/tool-browser.test.ts}` — the whole package shape to copy
5. `supabase/migrations/0006_architect_blueprints.sql` — the migration template
6. `supabase/migrations/0001_init.sql` lines 36-40, 74-80, 408-462 — RLS + GUC primitives
7. `apps/runner/src/custom-tools.ts` — the dispatch map to extend
8. `packages/vault/src/index.ts` lines 43-105 — the Refresher type + resolveAccessToken rotation logic
9. `packages/core/src/architect/hydrate.ts` lines 21-35 — the CANT_FAIL_KEYS set (add `secrets-rotation`)
10. `docs/acqu-phase-4-agent-manifest.md` — the manifest template
