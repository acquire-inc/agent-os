---
phase: 09-tenant-isolation-tester-secrets-rotation-external-launch-gat
plan: 04
subsystem: tool-registry-seeds + runner-dispatch
tags: [tools-registry, custom-tools-dispatch, propose-gating, D-01, D-03]
requires: [09-02 (@agent-os/tool-rls-test), 09-03 (@agent-os/core security exports), packages/vault]
provides:
  - 4 tool registry seed scripts (acqu-tool-{rls-test,vault-rotate,access-audit,access-log-analyzer}.ts)
  - 4 standalone seed runners (seed-tool-*.ts)
  - 4 new pnpm scripts under @agent-os/seed
  - 4 new customToolDispatch handlers in apps/runner/src/custom-tools.ts
affects: [09-05 agent seeds — each agent binds one of these tools]
tech-stack:
  added: ["@agent-os/db", "@agent-os/vault", "@agent-os/tool-rls-test" added as deps of @agent-os/runner]
  patterns: [tool.browser seed precedent, lazy-singleton db/vault key from env, D-01 in-runner-vs-hardgate split]
key-files:
  created:
    - scripts/seed/acqu-tool-rls-test.ts
    - scripts/seed/acqu-tool-vault-rotate.ts
    - scripts/seed/acqu-tool-access-audit.ts
    - scripts/seed/acqu-tool-access-log-analyzer.ts
    - scripts/seed/seed-tool-rls-test.ts
    - scripts/seed/seed-tool-vault-rotate.ts
    - scripts/seed/seed-tool-access-audit.ts
    - scripts/seed/seed-tool-access-log-analyzer.ts
  modified:
    - scripts/seed/package.json
    - apps/runner/src/custom-tools.ts
    - apps/runner/package.json
decisions:
  - "tool.vault-rotate requiresApproval=true (D-03 invariant) — client OAuth never rotates unilaterally; PreToolUse hook 1c gates dispatch."
  - "Other 3 tools requiresApproval=false (read-only attack/inventory/anomaly surfaces; false-pass caught by positive controls in attack-vectors.ts Pitfall 5)."
  - "D-01 in-runner-vs-hardgate split: runner-dispatched tool.rls-test uses ctx.db (likely service-role) for cron sanity; HARD GATE uses scripts/verify/isolation-live.ts (plan 09-06) with RLS_TEST_DATABASE_URL."
  - "Lazy db + vault-key singletons in custom-tools.ts — env may not be wired at module import; createDb + Buffer.from(AOS_VAULT_KEY,'hex') run on first dispatch."
metrics:
  duration: ~30m
  completed: 2026-06-01
requirements: [SC-9-2]
---

# Phase 9 Plan 04: Tool Registry Seeds + Runner Dispatch Summary

The bridge between the Wave-1/2 deterministic tool packages and the Wave-4 agent seeds. Four registry rows now seed idempotently via `ensureTool`, and `customToolDispatch` in the runner has four new handlers that compose them.

## Tool Matrix

| key | name | requiresApproval | reversible | dispatch handler input |
| --- | ---- | ---------------- | ---------- | ---------------------- |
| `tool.rls-test` | RLS Test Suite | **false** | true | `IsolationInput` ({tenantPairs, tables?}) |
| `tool.vault-rotate` | Vault Rotate | **true** ← D-03 | false | `{mcpId, provider: close\|meta\|stripe}` |
| `tool.access-audit` | Access Audit | **false** | true | `{tenantId}` |
| `tool.access-log-analyzer` | Access Log Analyzer | **false** | true | `{tenantId, hours?}` |

## pnpm Scripts Added (`scripts/seed/package.json`)

```
"tool-rls-test": "tsx seed-tool-rls-test.ts",
"tool-vault-rotate": "tsx seed-tool-vault-rotate.ts",
"tool-access-audit": "tsx seed-tool-access-audit.ts",
"tool-access-log-analyzer": "tsx seed-tool-access-log-analyzer.ts",
```

Each runs against `DATABASE_URL` and is idempotent (ensureTool upsert semantics).

## D-01 — In-Runner vs Hard-Gate Distinction

The `tool.rls-test` handler in the runner uses `getDb()` (lazy createDb from `DATABASE_URL`), which is the runner's service-role connection — that would normally false-pass every RLS check because service-role bypasses RLS. Two mitigations keep this safe:

1. **Positive controls** in `packages/tool-rls-test/src/attack-vectors.ts` — each vector first runs as userB and asserts ≥1 row visible. If service-role were silently used, the test would still bomb because the GUC-impersonation path needs RLS-aware behavior.
2. **The hard gate runs out-of-runner** in `scripts/verify/isolation-live.ts` (plan 09-06) — a separate process with `RLS_TEST_DATABASE_URL` (non-service-role) as the connection string. The in-runner tool is for cron-driven sanity checks, NOT the launch gate.

This split is annotated inline at the `tool.rls-test` handler.

## Runner Dispatch Shape

Handlers stay synchronous-imported (no dynamic require) so module load surfaces missing deps immediately. Lazy initialization of:
- `cachedDb` — `createDb(process.env.DATABASE_URL)` on first call.
- `getVaultKey()` — `Buffer.from(process.env.AOS_VAULT_KEY, 'hex')` per call (cheap; no caching needed).

A `pickRefresher(provider)` switch maps the provider name to `closeRefresher` (real) or `metaRefresher`/`stripeRefresher` (throwing stubs per D-03).

## Verification

- `pnpm --filter @agent-os/seed typecheck` — green.
- `pnpm --filter @agent-os/runner typecheck` — green.
- `pnpm --filter @agent-os/runner test` — 6/6 (existing custom-tools tests unchanged).
- `pnpm -r typecheck` — all 13 packages green.
- All 4 plan verify grep gates: OK (vault-rotate seeded with `requiresApproval: true`; all 4 ensureTool calls present; 4 new package.json scripts wired; 4 new dispatch handlers + D-01 citation in custom-tools.ts).

## What's Next (09-05)

- 4 T-critical agent seeds: `tenant-isolation-tester`, `secrets-rotation`, `access-auditor`, `security-anomaly-watchdog`.
- Each binds exactly one of the 4 tools seeded here via `AgentSpec.tools`.
- 4 SKILL.md stubs in `skills/security/`.
- `architect.test.ts` regression locks for the 4 keys in `CANT_FAIL_KEYS` (secrets-rotation already added to the set in 09-01).
- `secrets-rotation` cron set to `0 4 * * *` (04:00 daily) — Pitfall 2 enforcement.
