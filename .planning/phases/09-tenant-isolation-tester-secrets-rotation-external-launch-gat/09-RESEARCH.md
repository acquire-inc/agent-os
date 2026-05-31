# Phase 9: tenant-isolation-tester + secrets-rotation + access-auditor + security-anomaly-watchdog — Research

**Researched:** 2026-05-31
**Domain:** Multi-tenant security gate (Hard Gate #2 per main §6) — RLS verification, vault credential rotation, access auditing, anomaly detection.
**Confidence:** HIGH (the doctrine is canonical for this phase; build patterns are already shipped through Phase 7/8/8.5).

---

## Summary

Phase 9 is **different in kind** from the seed-only phases 2/5/6/8. Those phases were 100% data — agent rows + prompts + cron triggers. Phase 9 is **agents-as-data + the deterministic tools those agents need**. The doctrine (v2 D5.3) explicitly names four new tools — `tool.vault-auditor`, `tool.isolation-test-suite`, `tool.access-log-analyzer`, and references the existing OAuth vault. Three of the four agents are non-functional without their tools (only `secrets-rotation` could theoretically run with vault-direct reads). Therefore this phase ships:

1. **One migration** (0010) adding security-finding storage (`security_findings` + optional `isolation_test_results`) — these are the durable artifacts the four agents produce + consume.
2. **Three new packages or core modules** for the deterministic tools (`tool.rls-test`, `tool.vault-rotate`, `tool.access-audit`, `tool.access-log-analyzer`).
3. **Runner integration** — register the new tools in `customToolDispatch` (same pattern as `tool.browser` from Phase 7).
4. **Four seed scripts** following the exact pattern of `acqu-ad-claim-compliance.ts` (T-critical = `anthropic/claude-opus-4.8` script literal; tenant `default_model_override` will rewrite at seed time per Phase 8.5).
5. **A batch seed runner** (`seed-phase-9.ts`) + the `seed:phase-9` package.json script.
6. **A live verification run** of `tenant-isolation-tester` against every tenant-scoped table — this IS the hard gate. Until it passes 100%, Phase 10 (external Cliently) is blocked per main §6.

**Primary recommendation:** Structure the phase as **Wave 1 (migration + tools)** → **Wave 2 (4 seeds + runner registration)** → **Wave 3 (hard-gate verification run + manifest)**. The verification run is the contract; everything else is preparation.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| RLS policy enforcement | Database (Postgres) | — | RLS is a database feature; the test must connect *as different tenants* via `request.jwt.claim.sub` GUC, not bypass it via service-role |
| Cross-tenant attack simulation | API/Backend (Node test harness) | Database | The tester impersonates tenants by SET-ing the `request.jwt.claim.sub` GUC per session, then queries every tenant-scoped table |
| Vault credential rotation | Backend (packages/vault) | External providers (Stripe/Meta/Close OAuth refresh endpoints) | Vault lives in Postgres + `AOS_VAULT_KEY` env; rotation = re-encrypt + provider-side refresh |
| Access audit (grants inventory) | Backend (read-only SQL) | — | Pure aggregation across `oauth_credentials`, `agents`, `agent_mcps`, `agent_tools`, `tenant_members` |
| Anomaly detection | Backend (read-only SQL + pattern detection) | — | Pattern-match across `audit_log` + `autonomy_events` over rolling windows |
| Finding storage + Slack alerts | Backend + MCP (Slack) | — | Findings persist to DB; Slack MCP for human notification |
| Agent execution | Runner (Claude Agent SDK over OpenRouter) | — | Standard runner — the four agents are data rows that the runner dispatches via `customToolDispatch` |

---

## Standard Stack

### Core (already shipped, reuse)

| Library / module | Version | Purpose | Why standard |
|---|---|---|---|
| `@agent-os/db` (Drizzle + postgres-js) | workspace | Tenant-aware DB access | Phase 1 substrate |
| `@agent-os/vault` | workspace | OAuth credential encryption + refresh (already implements `resolveAccessToken` w/ refresher hook) | The thing `secrets-rotation` rotates |
| `@agent-os/core` `seedAgent` | workspace | Idempotent agent seeding; tenant `default_model_override` already wired | Phase 2/5/6/8 pattern |
| `@agent-os/core` `ensureTool` | workspace | Idempotent tool registry insert | Phase 7 pattern (`acqu-tool-browser.ts`) |
| `customToolDispatch` (`apps/runner/src/custom-tools.ts`) | workspace | Runner-side dispatch for custom registry tools | Phase 7 pattern (`tool.browser` precedent) |
| RLS via `is_tenant_member(t)` SECURITY DEFINER helper | migration 0001 | Every tenant-scoped table | Foundation — the thing being tested |
| `audit_log` + `autonomy_events` tables | migrations 0001 + 0003 | Source data for `security-anomaly-watchdog` | Already populated by hook 1a (PostToolUse audit) |
| `tsx` test harness | already in use | Stand-alone `.test.ts` files (no vitest config) | Established convention (`packages/*/src/*.test.ts`, `scripts/test-all.sh`) |

### New (this phase)

| Package / module | Purpose | When to use |
|---|---|---|
| `packages/tool-rls-test` (NEW) | Cross-tenant query attack suite — accepts tenantId pairs + table list, returns pass/fail per row | The hard-gate engine |
| `packages/tool-vault-rotate` (NEW, or extension to `packages/vault`) | Schedule-driven re-encrypt + provider refresh; flags long-TTL tokens | Bound to `secrets-rotation` agent |
| `packages/tool-access-audit` (NEW, or `packages/core/src/security/access-audit.ts`) | Inventories grants, flags orphans (departed users, archived agents, churned tenants) | Bound to `access-auditor` agent |
| `packages/tool-access-log-analyzer` (NEW, or `packages/core/src/security/anomaly.ts`) | Windowed pattern detection over `audit_log` + `autonomy_events` | Bound to `security-anomaly-watchdog` agent |

**Recommendation on packaging:** put `tool-rls-test` as its **own package** (it has a complex public surface: tenant impersonation, per-table assertions, regression-test additivity). Put the other three as **modules inside `@agent-os/core`** under `src/security/` — they're each small (one SQL aggregation + a formatter). This minimizes new workspace overhead. *[ASSUMED — final shape can be decided in discuss-phase.]*

### Verification

Doctrine model slugs in v2 D5.3 are `haiku-4-5` / `sonnet-4-6` (older shorthand). Per CLAUDE.md + main §1.5 + Phase 8 precedent, ALL FOUR Phase-9 agents are on the can't-fail list — script literals MUST be `anthropic/claude-opus-4.8` regardless of the doctrine's "haiku/sonnet" annotation. The Phase 8.5 `default_model_override` (currently `nousresearch/hermes-4-405b` per operator) will rewrite them at seed time; the script literal preserves doctrine intent. *[VERIFIED: CLAUDE.md "Can't-fail agents" line; main §1.5 line 88-91; HANDOFF-other-session.md §2 explicit Hermes/Opus tradeoff.]*

**Installation:** No new external dependencies required. Vault refresh hooks for Meta/Stripe/Close already exist via `packages/vault/src/index.ts` `Refresher` type — provider-specific refreshers are wired by the consumer, not the vault.

---

## Package Legitimacy Audit

| Package | Registry | Disposition |
|---|---|---|
| (none — phase uses only workspace packages) | — | N/A |

No external packages added. All new code is workspace-internal (`packages/tool-rls-test`, `packages/core/src/security/*`). The four agents use the existing Slack MCP — no new MCP registrations needed. *[VERIFIED: by inspection of existing packages/ tree.]*

---

## Architecture Patterns

### System Architecture Diagram

```
                                  ┌──────────────────────────────┐
       pg_cron / Inngest ──fire──►│  agents (lifecycle=active)   │
       (every 04:00 / 04:30       │                              │
        / Wed 05:00 / hourly)     │  • tenant-isolation-tester   │
                                  │  • secrets-rotation          │
                                  │  • access-auditor            │
                                  │  • security-anomaly-watchdog │
                                  └──────────┬───────────────────┘
                                             │ runner /next claim
                                             ▼
                            ┌──────────────────────────────────┐
                            │ apps/runner (Claude Agent SDK    │
                            │  via OpenRouter, model rewritten │
                            │  by tenant default_model_override│
                            │  — script default = opus-4.8)    │
                            └──────────┬───────────────────────┘
                                       │ customToolDispatch[key]
                                       ▼
        ┌──────────────────────────────┼────────────────────────────────┐
        │                              │                                │
        ▼                              ▼                                ▼
┌───────────────────┐  ┌────────────────────────┐   ┌──────────────────────────┐
│ tool.rls-test     │  │ tool.vault-rotate      │   │ tool.access-audit /      │
│ (NEW)             │  │ (NEW — wraps vault)    │   │ tool.access-log-analyzer │
│                   │  │                        │   │ (NEW)                    │
│ • set jwt.sub GUC │  │ • iterate vault rows   │   │ • SELECT joins across    │
│ • SELECT every    │  │ • call provider refresh│   │   oauth_credentials,     │
│   tenant-scoped   │  │ • re-encrypt + store   │   │   agents (lifecycle),    │
│   table as A      │  │ • flag long-TTL tokens │   │   tenant_members         │
│ • assert other    │  │                        │   │ • window over audit_log  │
│   tenants' rows   │  │                        │   │   + autonomy_events      │
│   not visible     │  │                        │   │                          │
└─────────┬─────────┘  └────────────┬───────────┘   └────────────┬─────────────┘
          │                         │                            │
          │                         ▼                            │
          │           ┌─────────────────────────┐                │
          │           │ external provider APIs  │                │
          │           │ (Stripe / Meta / Close  │                │
          │           │  OAuth refresh)         │                │
          │           └─────────────────────────┘                │
          │                                                      │
          └───────┬────────────────┬────────────────┬────────────┘
                  ▼                ▼                ▼
        ┌──────────────────────────────────────────────────┐
        │ security_findings table (NEW, migration 0010)    │
        │  • severity (low/med/high/critical)              │
        │  • category (isolation/rotation/access/anomaly)  │
        │  • status (open/acknowledged/resolved)           │
        │  • payload jsonb                                 │
        └────────────────────────┬─────────────────────────┘
                                 │
                                 ▼
                       ┌─────────────────────┐
                       │ Slack MCP (#security)│
                       │ + audit_log entry    │
                       └─────────────────────┘

ISOLATION FAILURE → block external launch (Phase 10 gate); P0 to founder via Slack.
```

### Recommended File Layout

```
packages/
├── tool-rls-test/              # NEW — the hard-gate engine
│   ├── package.json
│   └── src/
│       ├── index.ts            # public: runIsolationSuite(db, ctx)
│       ├── impersonate.ts      # SET LOCAL request.jwt.claim.sub
│       ├── attack-vectors.ts   # the test table — additive only
│       └── tool-rls-test.test.ts
├── core/src/security/          # NEW (lightweight ops tools)
│   ├── vault-rotate.ts         # vault rotation scheduler
│   ├── access-audit.ts         # grants inventory + orphan finder
│   ├── anomaly.ts              # audit_log/autonomy_events pattern matcher
│   └── *.test.ts
├── core/src/findings.ts        # NEW — security_findings insert helper
└── vault/src/index.ts          # EXTEND — add rotateCredential(refresher) helper

apps/runner/src/custom-tools.ts # EXTEND — register 3-4 new handlers

supabase/migrations/
└── 0010_security_findings.sql  # NEW — security_findings + RLS

scripts/seed/
├── acqu-tenant-isolation-tester.ts   # NEW
├── acqu-secrets-rotation.ts          # NEW
├── acqu-access-auditor.ts            # NEW
├── acqu-security-anomaly-watchdog.ts # NEW
├── seed-phase-9.ts                   # NEW (batch runner)
└── (seeds for the 3-4 new tool registry rows — pattern: seed-tool-browser.ts)

docs/acqu-phase-9-agent-manifest.md   # NEW (operator manifest, Phase 1-4 pattern)

external/acqu-skills/                  # NEW skill stubs (4)
├── tenant-isolation-testing/SKILL.md
├── secrets-rotation/SKILL.md
├── access-audit/SKILL.md
└── anomaly-detection-security/SKILL.md
```

### Pattern 1: RLS Tenant Impersonation (Postgres GUC)

The migration uses `auth.uid()` reading `request.jwt.claim.sub` — see 0001_init.sql lines 36-40. Tests impersonate by setting that GUC.

```typescript
// packages/tool-rls-test/src/impersonate.ts
// Source: supabase/migrations/0001_init.sql lines 36-40 (auth.uid impl)
import type { Db } from "@agent-os/db";
import { sql } from "drizzle-orm";

/** Run `fn` with auth.uid() bound to `userId` for this txn. Resets on commit/rollback. */
export async function asUser<T>(db: Db, userId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${userId}, true)`);
    return fn();
  });
}
```

### Pattern 2: T-Critical Agent Seed (verbatim from `acqu-ad-claim-compliance.ts`)

```typescript
// All 4 Phase-9 agents follow this script-literal shape.
// Model = claude-opus-4.8 in the script; tenant default_model_override rewrites at seed time.
export const tenantIsolationTesterSpec: AgentSpec = {
  tenantId: TENANT_IDS.acqu,
  key: "tenant-isolation-tester",
  name: "Tenant Isolation Tester",
  systemPrompt: SYSTEM_PROMPT,           // verbatim from v2 D5.3 L1311-1325
  model: "anthropic/claude-opus-4.8",    // CLAUDE.md can't-fail — NEVER Hermes in script
  thinkingLevel: "high",
  autonomy: "execute_safe",              // doctrine value (alerts only; no auto-revoke)
  knowledgeScope: { folders: ["security"], tags: ["security"] },
  budgetCapUsd: "1.50",
  cron: { schedule: "30 4 * * *" },      // daily 04:30 per v2 §D5.3 workflows
  tools: [{ key: "tool.rls-test", name: "RLS Test Suite", kind: "custom", requiresApproval: false, reversible: true }],
  skills: [
    { key: "tenant-isolation-testing", name: "Tenant Isolation Testing" },
    { key: "verification-before-completion", name: "Verification Before Completion" },
  ],
  mcpNames: ["Slack"],
  escalationPolicy: "tcritical:isolation_failure -> founder_p0",
};
```

### Pattern 3: Append-Only Regression Tests

The `tenant-isolation-tester` doctrine rule is: **"The test suite only grows. Never remove a test."** Encode this as a check in `attack-vectors.ts`:

```typescript
// packages/tool-rls-test/src/attack-vectors.ts
export const ATTACK_VECTORS = Object.freeze([
  { id: "AV-001", name: "tenant_isolation:tenants", ... },
  // every fixed bug = a new frozen entry. PRs that delete entries fail CI.
]);
```

### Anti-Patterns to Avoid

- **Using service-role connection for the RLS test.** Service-role bypasses RLS by design — a test passing with service-role tells you nothing. Tests MUST use a *RLS-enforced* connection and impersonate via GUC.
- **Auto-rotating client OAuth tokens.** v2 D5.3 line 1254 is explicit: "For CLIENT credentials … never rotate unilaterally — coordinate, propose, and only act with approval, since breaking a client's connection breaks their service." Encode this in `secrets-rotation` autonomy gate.
- **Auto-lockdown on anomaly without approval.** v2 D5.3 line 1351: "Never auto-lockdown without approval unless it matches a pre-approved containment runbook." Default autonomy stays `execute_safe` (alert), with `propose` for any containment action.
- **Removing isolation tests.** The doctrine forbids shrinking the suite. Build the additivity check now, not later.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Tenant impersonation for tests | Custom JWT generator + Supabase auth flow | Direct `set_config('request.jwt.claim.sub', uuid, true)` per transaction | The `auth.uid()` helper in 0001_init.sql already reads this GUC — bypasses the entire auth layer cleanly for tests |
| Token encryption | New cipher | `packages/vault/src/crypto.ts` `encrypt`/`decrypt` already use `AOS_VAULT_KEY` | Vault is the source of truth; rotating creds means re-encrypting via the existing helper |
| OAuth refresh | Per-provider HTTP clients | `Refresher` type in `packages/vault/src/index.ts` line 43 — provider-specific refreshers plug into `resolveAccessToken` | Already wired; `secrets-rotation` should pass a refresher to vault, not call providers directly |
| Audit log writes | Custom logger | The existing `audit_log` table (migration 0001) + hook 1a (PostToolUse audit, Phase 1) | Already populated by every tool call |
| Cron registration | Custom scheduler | `agent_triggers` + pg_cron→Inngest bridge (migration 0008) | Phase 7 ships this; `seedAgent` writes triggers automatically |
| Approval gate | Custom approval workflow | Hook 1c (PreToolUse approval gate, Phase 1) + `approvals` table | Already enforces `requiresApproval=true` on registry tools |

**Key insight:** The existing OS already provides 80% of the security plumbing. Phase 9 mostly *uses* the substrate (RLS, vault, audit_log, autonomy_events, approval gate, customToolDispatch) — it does not rebuild any of it.

---

## Runtime State Inventory

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | **None — Phase 9 adds new tables, doesn't rename existing data.** Migration 0010 adds `security_findings`; agents/tools/triggers seed idempotently via `seedAgent` upserts. | None |
| Live service config | Inngest event registrations: the 4 new agents fire via pg_cron (already bridged to Inngest event `agent/scheduled.run` per migration 0008) → no Inngest console changes needed. | None — automatic via `agent_triggers` |
| OS-registered state | None (no Windows/launchd/systemd registrations in scope) | None |
| Secrets/env vars | `AOS_VAULT_KEY` (already required); provider refresh credentials (e.g. Meta app secret) needed for `secrets-rotation` to actually refresh OAuth tokens. The Refresher functions need provider client IDs/secrets. | Document required env vars; do not auto-rotate against providers in seed run |
| Build artifacts | None (no compiled-name dependencies) | None |

---

## Common Pitfalls

### Pitfall 1: Testing RLS with the wrong connection role
**What goes wrong:** Test passes locally with service-role (which bypasses RLS), then a paying client's data leaks in production.
**Why it happens:** Drizzle's `createDb` typically connects with the service key from `DATABASE_URL`; service role is RLS-exempt.
**How to avoid:** The `tool.rls-test` MUST connect with an `anon` or `authenticated` role connection string (separate env var, e.g. `DATABASE_URL_RLS`), then impersonate per test via GUC. Document this in `tool-rls-test/README.md`.
**Warning signs:** A test asserts "tenant A reads B's row → returns 0" and it passes immediately on a service-role connection. Add a meta-test: "without impersonation, a read of tenant B's row returns 1" — confirms the connection is *not* RLS-exempt.

### Pitfall 2: Vault rotation race condition mid-agent-run
**What goes wrong:** `secrets-rotation` rotates a credential while another agent is mid-call using the old token; the in-flight call fails (or worse, partially succeeds with inconsistent state).
**Why it happens:** Vault rotation = re-encrypt + replace; in-memory tokens already issued via `makeBundleTokenResolver` keep working until they hit the provider with the now-stale token.
**How to avoid:** (a) Set `secrets-rotation` autonomy `execute_safe` only for internal/system credentials; client OAuth always `propose`. (b) The `Bundle` token resolver in `packages/vault/src/index.ts` already returns short-TTL tokens (≤300s) — keep rotations to scheduled windows (04:00 daily) and let in-flight tokens expire naturally rather than invalidating actively. (c) Track `rotation_in_progress` flag if you must hard-cut.
**Warning signs:** `connector-health-monitor` flips a connection to `needs_reauth` immediately after a rotation — that's a race that broke an in-flight call.

### Pitfall 3: Audit-log volume explosion → anomaly detector becomes useless
**What goes wrong:** `security-anomaly-watchdog` runs hourly, scanning `audit_log`. As tenant + agent count grows, audit_log row counts hit millions; the watchdog times out or false-positives wildly.
**Why it happens:** Hook 1a (PostToolUse) writes one row per tool call. With 50+ agents × hourly cadences × multiple tool calls each, audit_log grows ~10⁴–10⁵ rows/day per tenant.
**How to avoid:** (a) Migration 0010 adds an index `audit_log(tenant_id, ts DESC)` if not already present. (b) Anomaly detector scans a rolling 24h window only, not full history. (c) Surface baseline + delta, not absolute counts — "this credential was used 5× yesterday and 500× today" is the signal.
**Warning signs:** Watchdog `run.cost_usd` climbs over time; runtime > 60s.

### Pitfall 4: False positives on `access-auditor` orphan check vs Phase 8.5 lifecycle
**What goes wrong:** Agents in `lifecycle_state='archived'` still have rows in `agent_skills`/`agent_mcps`/`agent_tools` (lifecycle is non-destructive per Phase 8.5 spec). `access-auditor` flags every archived agent's bindings as orphaned grants → 50 false positives on day one.
**Why it happens:** Phase 8.5 deliberately *preserves* history on archive — rows are not deleted, just `lifecycle_state` changes.
**How to avoid:** `access-auditor` orphan logic is "archived agent with bindings to high-privilege MCPs AND no archive_date set" or "archived > 30 days with bindings still active in some other agent's chain." Don't flag every archived-agent binding.
**Warning signs:** First-run access audit returns hundreds of findings — almost all are archived-agent noise.

### Pitfall 5: "False pass" on isolation test
**What goes wrong:** Test queries return zero rows — but they would have returned zero rows for any reason (typo in tenant ID, table genuinely empty, GUC set wrong). Test reports PASS when nothing was actually tested.
**Why it happens:** "Read returns 0" is the *expected* RLS outcome; "Read returns N" is the failure outcome. So zero-rows is ambiguous — could mean "RLS worked" or "test was broken."
**How to avoid:** Every attack-vector test MUST be paired with a *positive control*: (1) Insert row for tenant B, (2) Read as tenant A → expect 0, (3) Read as tenant B (same query) → expect ≥1. Step 3 is the proof that the test is wired. If step 3 returns 0, the test setup is broken — not a pass.
**Warning signs:** Suite runs in milliseconds with 100% pass; no rows inserted; no errors logged. (Per main §1.5 line 90: "a false 'pass' is a cross-tenant breach.")

### Pitfall 6: Operator override on can't-fail agent (Hermes vs Opus tension)
**What goes wrong:** Operator set `tenants.default_model_override = 'nousresearch/hermes-4-405b'` (Phase 8.5 directive). Seed scripts will rewrite all 4 Phase-9 agents from `claude-opus-4.8` → `hermes-4-405b`. Doctrine assumed Opus because *a false isolation pass is unrecoverable*; Hermes 4 405B is strong reasoning but not battle-tested for security judgment.
**Why it happens:** `seedAgent` (per Phase 8.5) reads the tenant override and rewrites `spec.model` on insert/update; a console warning prints when overriding a can't-fail default, but the override wins.
**How to avoid:** Document the tradeoff in the phase manifest (operator made this call eyes-open per HANDOFF-other-session.md §2). Provide a 1-command rollback (`PUT /api/admin/tenants/me/model-override { model: null }` + re-apply). Phase 9 should NOT silently relax the script literal — keep `claude-opus-4.8` in `acqu-tenant-isolation-tester.ts` so when the override is cleared, doctrine intent is restored.
**Warning signs:** None at runtime — only surfaces if the operator audits seeded `agents.model` values vs script literals.

---

## Code Examples

### RLS impersonation test pattern (with positive control)

```typescript
// packages/tool-rls-test/src/attack-vectors.ts
import { asUser } from "./impersonate.js";
import { sql } from "drizzle-orm";

export async function testTenantsTable(db: Db, ctx: IsolationCtx) {
  const { userA, userB, tenantA, tenantB } = ctx;

  // Setup: insert known rows for each tenant (already inserted in fixture).
  // Positive control — proves the test is wired:
  const posCtl = await asUser(db, userB, () =>
    db.execute(sql`select id from tenants where id = ${tenantB}`)
  );
  if (posCtl.length !== 1) throw new Error("AV-001 wiring broken: tenant B can't see itself");

  // Attack: tenant A tries to read tenant B's row.
  const attack = await asUser(db, userA, () =>
    db.execute(sql`select id from tenants where id = ${tenantB}`)
  );
  return {
    id: "AV-001",
    table: "tenants",
    passed: attack.length === 0,
    actual: attack.length,
    expected: 0,
  };
}
```

### Vault rotation with Refresher (reuses existing vault.ts)

```typescript
// packages/core/src/security/vault-rotate.ts
import { resolveAccessToken, storeCredential, type Refresher } from "@agent-os/vault";

export async function rotateCredential(
  db: Db, key: Buffer, mcpId: string, refresher: Refresher,
): Promise<{ rotated: boolean; reason?: string }> {
  // resolveAccessToken already handles "expired → refresh → re-store".
  // For active rotation, force expiry by calling refresher directly:
  const [cred] = await db.select().from(oauthCredentials).where(eq(oauthCredentials.mcpId, mcpId));
  if (!cred?.expiresAt) return { rotated: false, reason: "no expiry — manual provider rotation required" };
  const tokens = JSON.parse(decrypt(cred.vaultRef, key));
  if (!tokens.refresh) return { rotated: false, reason: "no refresh token — needs_reauth flow" };
  const fresh = await refresher(tokens.refresh);
  if (!fresh) return { rotated: false, reason: "provider refresh failed" };
  await storeCredential(db, key, { tenantId: cred.tenantId, mcpId, ...fresh });
  return { rotated: true };
}
```

### Access audit orphan query

```typescript
// packages/core/src/security/access-audit.ts
import { sql } from "drizzle-orm";

export async function findOrphanedGrants(db: Db, tenantId: string) {
  // OAuth creds bound to archived agents via agent_mcps:
  return db.execute(sql`
    select oc.id, oc.mcp_id, m.name as mcp_name, a.key as agent_key, a.lifecycle_state
    from oauth_credentials oc
    join agent_mcps am on am.mcp_id = oc.mcp_id
    join agents a on a.id = am.agent_id
    join mcps m on m.id = oc.mcp_id
    where oc.tenant_id = ${tenantId}
      and a.lifecycle_state = 'archived'
  `);
}
```

### Registering a new custom tool in the runner

```typescript
// apps/runner/src/custom-tools.ts — extend the existing dispatch map
import { runIsolationSuite } from "@agent-os/tool-rls-test";

export const customToolDispatch: Record<string, CustomToolHandler> = {
  "tool.browser": async (input, ctx) => { /* existing */ },
  "tool.rls-test": async (input, ctx) => {
    const result = await runIsolationSuite(input as IsolationInput);
    return { result };
  },
  "tool.vault-rotate": async (input, ctx) => { /* … */ },
  "tool.access-audit": async (input, ctx) => { /* … */ },
  "tool.access-log-analyzer": async (input, ctx) => { /* … */ },
};
```

---

## State of the Art

| Old Approach | Current Approach (this phase) | Why |
|---|---|---|
| Test RLS via service-role queries asserting they "should fail" | Test RLS via tenant impersonation (`set_config('request.jwt.claim.sub', uuid)`) with positive controls | Service-role bypasses RLS by design; impersonation tests the actual production path |
| Rotate all credentials on schedule | Rotate internal/system creds on schedule; PROPOSE client cred rotations | Client OAuth rotation can break their service — coordinate, never unilaterally rotate |
| Block agent runs immediately on anomaly | Tier alerts: high→propose containment + alert; medium→alert; low→log | Auto-lockdown false positives breaks legitimate operations; containment is human-approved unless pre-runbooked |
| Build SOC dashboards for human review | Agent-as-data: watchdog agent reads logs + proposes containment via Slack | The doctrine non-negotiable: monitoring is an agent, not a UI |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `tool-rls-test` should be its own package; the other 3 tools should live in `packages/core/src/security/` | Standard Stack / File Layout | Low — packaging is reversible; the planner / operator decides shape |
| A2 | The runner needs separate env var (`DATABASE_URL_RLS`) for an RLS-enforced connection for the test tool | Pitfall 1 | Medium — if `DATABASE_URL` is already a non-superuser, this is unnecessary. Verify in discuss-phase. |
| A3 | Migration 0010 should add a `security_findings` table to persist findings across runs | Recommended File Layout | Low — alternative is to write findings to `kb:security/` as markdown only. Either works; persistent table enables query/aggregation by `access-auditor` and the watchdog. |
| A4 | `access-auditor` Wednesday 05:00 / weekly cadence matches doctrine | v2 D5.3 L1269 — VERIFIED |  — |
| A5 | `tenant-isolation-tester` should also run on schema/RLS changes merged to main (doctrine L1300 "event"), not just daily | Standard Stack | Medium — if not wired, drift between code and tests is possible. Recommend a GitHub Actions hook (out of scope this phase) or simply re-run via runner on demand. |
| A6 | `security_findings` and `isolation_test_results` are separate concerns; combine or split is a discuss-phase decision | File Layout | Low |
| A7 | Provider refresh credentials (Meta app secret, Stripe restricted key) are stored in `env_vars` table not vault — vault is for *user* OAuth tokens | Don't Hand-Roll | Medium — if provider creds aren't already loaded, `secrets-rotation` can only flag, not act. Verify in environment audit. |

---

## Open Questions

1. **Should `tool.rls-test` connect via a separate RLS-enforced DB user, or via the same `DATABASE_URL` with `RESET ROLE` discipline?**
   - What we know: 0001_init.sql uses `auth.uid()` reading a GUC — works either way for impersonation.
   - What's unclear: Whether the existing `DATABASE_URL` is service-role (RLS-exempt) or `authenticated`-role (RLS-enforced). Phase 7 RLS tests pass via service-role connections (`packages/core/src/integration.test.ts` line 206-216 reads cross-tenant rows and asserts they return 0 — but if service-role, this assertion is trivially false. Worth re-reading carefully).
   - Recommendation: discuss-phase confirms which role `DATABASE_URL` uses. If service-role, add `DATABASE_URL_RLS` for the test tool.

2. **`security_findings` table or kb-only?**
   - What we know: doctrine specifies `kb:security/isolation-{date}.md` and `kb:security/access-audit-{week}.md`.
   - What's unclear: whether to also persist findings to a DB table for cross-agent queries (e.g. `security-anomaly-watchdog` correlating with `access-auditor` findings per E.5 chain).
   - Recommendation: add the table. Kb files are operator-readable; DB rows are agent-queryable. Both serve different needs.

3. **OAuth refresh implementations — scope this phase or defer?**
   - What we know: `packages/vault/src/index.ts` has a `Refresher` type but no concrete implementations.
   - What's unclear: whether `secrets-rotation` ships with refreshers for Meta/Stripe/Close, or only the rotation framework (refreshers come per-MCP later).
   - Recommendation: ship the framework + one reference implementation (Close, since it's already in the MCP catalog) + leave others as TODO. Otherwise this phase's surface area doubles.

4. **Should the hard-gate verification run be part of Phase 9 plan execution, or a separate `/gsd-verify` step?**
   - What we know: external launch is blocked until `tenant-isolation-tester` passes per main §6.
   - What's unclear: whether the planner treats the verification run as a Phase-9 task (block PHASE-9 completion until pass) or as Phase 10 prereq.
   - Recommendation: include in Phase 9. Until the suite passes, the agent is hypothetical — the phase isn't done.

5. **`security-anomaly-watchdog` baseline period?**
   - What we know: doctrine says "hourly" without specifying baseline window.
   - What's unclear: how long the watchdog needs to observe before flagging anomalies (cold-start problem).
   - Recommendation: 7-day rolling baseline; suppress alerts during first 7 days post-deploy unless rate exceeds an absolute floor.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Postgres + RLS | `tool.rls-test` | ✓ (via Supabase) | 16+ | — |
| `AOS_VAULT_KEY` env | `secrets-rotation` | Already required (Phase 1) | — | — |
| Slack MCP | All 4 agents | ✓ (catalog seed) | — | — |
| Provider OAuth client IDs (Meta/Close/Stripe) | `secrets-rotation` refreshers | Unknown — depends on operator setup | — | Flag-only mode (don't refresh, alert operator) |
| `DATABASE_URL_RLS` (RLS-enforced connection) | `tool.rls-test` | NOT confirmed | — | Use service-role with explicit `RESET ROLE` per txn — risky, requires Postgres role infrastructure |
| Inngest signing key | Triggers (cron → Inngest events) | Operator-deferred per Phase 7 STATE.md | — | pg_cron direct still works as fallback |

**Missing with no fallback:**
- Confirmation of `DATABASE_URL` role privilege level. **Resolve in discuss-phase** — if blocking, the planner adds an env-var task.

**Missing with fallback:**
- Provider refresh credentials → `secrets-rotation` runs in flag-only mode (still useful: flags stale creds, never rotates without operator).

---

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | tsx-based stand-alone `.test.ts` files (no vitest; pattern verified across all 9 existing test files) |
| Config file | none — each package has `"test": "tsx src/*.test.ts"` in its `package.json` |
| Quick run command | `pnpm --filter @agent-os/tool-rls-test test` (per-package) |
| Full suite command | `bash scripts/test-all.sh` (root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| SC-9-1 | `tenant-isolation-tester` passes against every tenant-scoped table (cross-tenant read returns 0 with positive control) | integration | `pnpm --filter @agent-os/tool-rls-test test` | ❌ Wave 0 |
| SC-9-1.b | Hard gate verification: live run against current schema returns 100% pass | integration (live DB) | `pnpm seed:phase-9 && pnpm run verify:isolation` (new script) | ❌ Wave 0 |
| SC-9-2 | `secrets-rotation` runs against vault; expired creds trigger `needs_reauth` flip | unit | `pnpm --filter @agent-os/core test:security` | ❌ Wave 0 |
| SC-9-3 | `access-auditor` flags archived-agent OAuth bindings as orphans | unit | `pnpm --filter @agent-os/core test:security` | ❌ Wave 0 |
| SC-9-4 | `security-anomaly-watchdog` detects 10× usage spike on a single credential within 24h window | unit | `pnpm --filter @agent-os/core test:security` | ❌ Wave 0 |
| SC-9-5 | All 4 agents seed idempotently via `pnpm seed:phase-9`; model literals `claude-opus-4.8`; tenant override (if set) rewrites to current value | integration | `pnpm seed:phase-9 && psql -c "select key, model from agents where key in (...)"` | ❌ Wave 0 |
| SC-9-6 | Architect refuses to assemble can't-fail Phase-9 agents (regression — same rule as `ad-claim-compliance`) | unit | `pnpm --filter @agent-os/core run test:architect` | ✓ (file exists; needs new assertions) |
| SC-9-7 | Findings persist to `security_findings` with RLS enforcement; cross-tenant read returns 0 | integration | `pnpm --filter @agent-os/core test:integration` | ✓ extends existing |

### Sampling Rate
- **Per task commit:** `pnpm -r typecheck` + per-package test (≤ 30s)
- **Per wave merge:** `bash scripts/test-all.sh` (full suite)
- **Phase gate:** Full suite green + **live isolation run on a database with at least 2 seeded tenants and ≥1 row per tenant-scoped table** before `/gsd-verify-work`. This is the contract.

### Wave 0 Gaps
- [ ] `packages/tool-rls-test/src/tool-rls-test.test.ts` — covers SC-9-1
- [ ] `packages/core/src/security/vault-rotate.test.ts` — covers SC-9-2
- [ ] `packages/core/src/security/access-audit.test.ts` — covers SC-9-3
- [ ] `packages/core/src/security/anomaly.test.ts` — covers SC-9-4
- [ ] `scripts/verify/isolation-live.ts` — covers SC-9-1.b (real DB, two tenants, positive controls)
- [ ] Extend `packages/core/src/architect/architect.test.ts` with assertions that the 4 Phase-9 agent keys are in the can't-fail refusal list

---

## Security Domain

> `security_enforcement: true` in `.planning/config.json` — this phase IS the security domain. ASVS mapping is the meta-check: do the agents we ship satisfy the categories that apply to this phase's own behavior?

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes | Supabase `auth.users` + JWT; the test tool simulates via GUC, doesn't bypass |
| V3 Session Management | yes | Short-TTL bundle tokens (≤300s) via `makeBundleTokenResolver` — keep this discipline; no long-lived in agent context |
| V4 Access Control | **yes (core)** | RLS via `is_tenant_member()` SECURITY DEFINER; `tool.rls-test` IS the V4 verification |
| V5 Input Validation | yes | Tool input schemas (zod in `tool-browser`; same pattern for new tools); JSON Schema also recorded in `tools.input_schema` for runner-side validation |
| V6 Cryptography | yes | Vault uses Node `crypto` (existing `packages/vault/src/crypto.ts`); rotation reuses, doesn't reimplement |
| V7 Error Handling & Logging | yes | `audit_log` (hook 1a) + `autonomy_events` (Phase 1) are the source data for `security-anomaly-watchdog` |
| V8 Data Protection | yes | OAuth tokens encrypted at rest (vault); `security_findings` payload should NOT include raw tokens — only refs |
| V9 Communications | partial | Out of scope for this phase (TLS is Supabase/Railway-managed); revisit at Phase 10 launch |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Cross-tenant data leak via RLS bypass | Information Disclosure | `tool.rls-test` daily + on schema change; service-role connections audited |
| Prompt injection in tenant A's data tricks agent into accessing tenant B | Tampering / IDU | `tenant-isolation-tester` doctrine line 1316: "Test the agent layer specifically: can an agent scoped to tenant A be tricked … into accessing tenant B?" — include prompt-injection vectors in the suite |
| Stale OAuth token exfiltrated, used after vault deletion | Spoofing | Short TTL (already wired); `secrets-rotation` flags long-TTL creds |
| Orphaned credentials after agent archive / human departure | Elevation of Privilege | `access-auditor` weekly |
| Audit log tampering | Repudiation | RLS on `audit_log` + append-only by hook 1a; rotation/aggregation not in scope |
| Mass credential use anomaly (compromised key) | Spoofing / Elevation | `security-anomaly-watchdog` hourly; rolling baseline |

---

## Project Constraints (from CLAUDE.md)

| Constraint | Source | Phase-9 Implication |
|---|---|---|
| **Agents are DATA, not code.** | CLAUDE.md "The one rule" | 4 agents = seed scripts; the *tools* they bind to ARE the only new code |
| **Model is config, never hardcoded; start cheap, promote on eval.** | CLAUDE.md non-negotiable #1 | Script literal = `claude-opus-4.8` (can't-fail); tenant override rewrites |
| **Multi-tenant from day one. Cross-tenant read returns zero rows — including the vector store and the runner's view. Tested, not assumed.** | CLAUDE.md non-negotiable #2 | This is THE phase that operationalizes this rule |
| **Safety via hooks** (PreToolUse / PostToolUse / Stop / SessionEnd) | non-negotiable #3 | Reuse: don't reimplement approval gates inside tools |
| **Tools save large outputs to files and return the path.** | non-negotiable #4 | `customToolDispatch` already writes results to tmp files (pattern in `apps/runner/src/custom-tools.ts` line 60-64) |
| **Three hard gates** — including "no external multi-tenant Cliently before tenant-isolation-tester passes" | non-negotiable #5 | This phase IS hard gate #2 |
| **Plan before code. Small PRs. Tests are verification step — failing test first.** | Working conventions | Wave 0 task in each plan = failing test for SC-9-N |
| **Knowledge file naming:** `{company}_{project}_{type}_{slug}_{yyyy-mm-dd}.md` | Working conventions | Findings kb files: `acqu_security_isolation-test_<date>.md` |

---

## Cost / Scope Estimate

| Item | Estimate |
|---|---|
| New code (excluding tests) | ~600-900 LOC (one new package + 3 modules in core + runner registration + 4 seeds + 1 batch runner + 1 manifest) |
| New tests | ~400-600 LOC (4 unit test files + 1 integration extension) |
| New migration | ~50 LOC (security_findings + indexes + RLS) |
| Plans (estimate) | **5-7 plans**, organized in 3 waves: Wave 1 (migration + tools, 3 plans), Wave 2 (seeds + runner wiring, 2 plans), Wave 3 (verification run + manifest, 1-2 plans) |
| Estimated implementation effort | 1-2 sessions on the doctrine pattern (substrate is shipped; this is composition + the new tool layer) |
| Hard gate runtime cost (post-deploy) | All 4 agents on hermes-4-405b (per operator override) ≈ <$10/mo combined at doctrine cadences. On script-literal opus-4.8 ≈ $40-60/mo combined. Trivial vs. the breach risk it prevents. |

---

## Sources

### Primary (HIGH confidence)
- `/home/user/agent-os/CLAUDE.md` — non-negotiables; can't-fail agent list (all 4 Phase-9 agents present)
- `/home/user/agent-os/docs/main-acqu-agent-doctrine.md` §1.5 (line 88-91); §6 (build deltas line 218); §6 hard gates (line 1944-1946 in v2 doctrine, cross-referenced from main)
- `/home/user/agent-os/docs/acqu-agent-doctrine-v2.md` §D5.3 (lines 1206-1362) — full agent specs for all 4
- `/home/user/agent-os/docs/acqu-agent-doctrine-v2.md` §E.5 (lines 1829-1840) — Infra/Security alert routing chain
- `/home/user/agent-os/docs/acqu-agent-doctrine-v2.md` Part F Phase 5 (lines 1929-1938) — Phase 9 belongs to v2's Phase 5 build order
- `/home/user/agent-os/supabase/migrations/0001_init.sql` — RLS policy structure + `is_tenant_member()` + `auth.uid()` GUC pattern (lines 36-40, 408-462)
- `/home/user/agent-os/packages/vault/src/index.ts` — `Refresher` type (line 43), `resolveAccessToken` flow (line 54), `makeBundleTokenResolver` short-TTL pattern (line 98)
- `/home/user/agent-os/packages/db/src/schema.ts` — all referenced tables (`oauth_credentials` 241, `agents.lifecycleState` 91, `auditLog` 353, `autonomyEvents` 342, `tools` 226, `agentTools` 126, `tenants.defaultModelOverride` 34)
- `/home/user/agent-os/scripts/seed/acqu-ad-claim-compliance.ts` — the T-critical seed template
- `/home/user/agent-os/scripts/seed/acqu-tool-browser.ts` + `seed-tool-browser.ts` — the tool registry seed template
- `/home/user/agent-os/apps/runner/src/custom-tools.ts` — `customToolDispatch` registration pattern
- `/home/user/agent-os/packages/core/src/integration.test.ts` lines 180-217 — existing RLS test pattern (verified relevant)
- `/home/user/agent-os/.planning/STATE.md` — Phase 7/8/8.5 substrate confirmation
- `/home/user/agent-os/docs/HANDOFF-other-session.md` §2 — explicit Hermes-vs-Opus tradeoff for can't-fail agents

### Secondary (MEDIUM confidence)
- `/home/user/agent-os/.planning/phases/08-phase-4-doctrine-batch-seed-moat-meta-layer/08-RESEARCH.md` — Phase 8 manifest pattern that Phase 9 should mirror

### Tertiary (LOW confidence — assumptions flagged in Assumptions Log)
- None — no external sources required; the doctrine is canonical for this phase's scope.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every component is either shipped or follows an established pattern with worked example
- Architecture: **HIGH** — the doctrine is explicit (v2 D5.3); the runner+tool+seed substrate is shipped
- Pitfalls: **HIGH** for #1, #2, #4, #5 (verified against schema/code); **MEDIUM** for #3 (volume projection is reasoned, not measured) and #6 (depends on operator policy)
- Tool packaging shape (one package vs core modules): **MEDIUM** — A1 in Assumptions Log; reversible decision
- DB role for RLS testing: **MEDIUM** — A2 in Assumptions Log; resolve in discuss-phase

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (stable substrate; valid for ~30 days unless major model/runtime changes ship)
