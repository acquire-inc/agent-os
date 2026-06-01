---
phase: 09-tenant-isolation-tester-secrets-rotation-external-launch-gat
plan: 03
subsystem: security-ops-modules
tags: [security, oauth-rotation, access-audit, anomaly, vault, fail-closed]
requires: [09-01 (findings.ts, security_findings table), packages/vault]
provides:
  - rotateCredential (eager OAuth rotation; records 'rotation' finding on failure)
  - closeRefresher (D-03 reference impl)
  - metaRefresher + stripeRefresher (D-03 fail-closed stubs — throw on call)
  - findOrphanedGrants (archived>30d + active OAuth = stale grant; Pitfall 4)
  - detectUsageSpikes (24h window vs 7d baseline; floor n>10; ratio>5×; Pitfall 3)
affects: [09-04 tool registry seeds, 09-05 secrets-rotation/access-auditor/anomaly-watchdog agent seeds]
tech-stack:
  added: ["@agent-os/vault" added as dep of @agent-os/core]
  patterns: [drizzle sql tagged-template, mock-db sql-capture test, recordFinding writer reuse]
key-files:
  created:
    - packages/core/src/security/vault-rotate.ts
    - packages/core/src/security/vault-rotate.test.ts
    - packages/core/src/security/access-audit.ts
    - packages/core/src/security/access-audit.test.ts
    - packages/core/src/security/anomaly.ts
    - packages/core/src/security/anomaly.test.ts
    - packages/core/src/security/refreshers/close.ts
    - packages/core/src/security/refreshers/stubs.ts
  modified:
    - packages/core/src/index.ts
    - packages/core/package.json
decisions:
  - "D-03 honored: Close = REFERENCE OAuth impl; Meta + Stripe THROW (fail-closed). Never silently succeed without a real refresh."
  - "D-07 honored: anomaly thresholds (n>10, 5× ratio, 24h/7d windows) inlined as constants — not knobs. Tightening goes through agent-evaluator scorecard, not param surgery."
  - "Pitfall 2 (race): cron-windowed rotation + ≤300s makeBundleTokenResolver TTL contract — in-flight tokens expire naturally rather than being invalidated."
  - "Pitfall 3 (audit_log volume): 24h current window + 8d→1d baseline + audit_log_tenant_ts_idx (added 09-01) keep planner cost bounded."
  - "Pitfall 4 (archived-agent FPs): findOrphanedGrants filters lifecycle_state='archived' AND archived>30d; respects Phase 8.5 non-destructive archive."
metrics:
  duration: ~1h
  completed: 2026-06-01
requirements: [SC-9-2]
---

# Phase 9 Plan 03: Security Ops Modules Summary

The three Phase-9 security tool bodies (rotation, access audit, anomaly scan) now live as lightweight modules inside `@agent-os/core` per packaging recommendation A1 — single SQL aggregations or vault-call wrappers, each tested standalone with a mock db (no live DB, no live HTTP).

## What Was Built

| Task | Module | Tests | Status |
| ---- | ------ | ----- | ------ |
| 1 | `vault-rotate.ts` + refreshers/close + refreshers/stubs | `vault-rotate.test.ts` 7/7 | green |
| 2 | `access-audit.ts` + `anomaly.ts` | `access-audit.test.ts` 6/6 + `anomaly.test.ts` 7/7 | green |

Combined: `pnpm --filter @agent-os/core test:security` → **26 passed, 0 failed** (chains all 4 security test files including 09-01's `findings.test.ts`).

## Module Signatures

```ts
// vault-rotate.ts
export interface RotateResult { rotated: boolean; reason?: string }
export async function rotateCredential(
  db: Db, key: Buffer, mcpId: string, refresher: Refresher,
): Promise<RotateResult>

// access-audit.ts
export async function findOrphanedGrants(db: Db, tenantId: string)
//   → rows where lifecycle_state = 'archived' AND archived > 30 days
//     (joins oauth_credentials → agent_mcps → agents → mcps)

// anomaly.ts
export async function detectUsageSpikes(
  db: Db, tenantId: string, window?: { hours: number },
)
//   CTE: current_window (24h) vs baseline (8d→1d, /7 daily_avg)
//   filter: c.n > 10 AND (baseline null OR ratio > 5)
```

## Refresher Provider Matrix (D-03)

| Provider | File | Behavior |
| -------- | ---- | -------- |
| Close.io | `refreshers/close.ts` | **Reference** — RFC 6749 §6 POST to `https://api.close.com/oauth2/token`, parses `{ access_token, refresh_token?, expires_in }`, returns null on non-200 |
| Meta     | `refreshers/stubs.ts` | **Throws** `"operator: implement provider refresher — see docs/HANDOFF-other-session.md"` |
| Stripe   | `refreshers/stubs.ts` | **Throws** (same string) |

Stubs throw rather than return null so the gap surfaces to the operator on first call rather than silently lingering as a stale-token finding.

## Pitfall Mitigations Encoded in Source

- **Pitfall 2 (rotation race)**: cited in `vault-rotate.ts` header — cron-windowed rotation (set in 09-04 seed) + ≤300s `makeBundleTokenResolver` TTL contract; in-flight tokens expire naturally.
- **Pitfall 3 (audit_log volume)**: 24h rolling current window + 8d→1d fixed-lookback baseline + absolute floor `n > 10` + `audit_log_tenant_ts_idx` (from migration 0010, plan 09-01).
- **Pitfall 4 (archived-agent FPs)**: `findOrphanedGrants` filters `lifecycle_state = 'archived' AND lifecycle_changed_at < now() - interval '30 days'` — respects Phase 8.5 non-destructive archive policy.

## Test Strategy

Tests use a SQL-string capture pattern: a mock `db.execute` walks the drizzle `sql` tagged-template `queryChunks` tree and concatenates string fragments, letting the test assert on the rendered SQL without a live DB. This locks the Pitfall 3/4 filter clauses against regression at the source level — anyone who rewrites the CTE or removes the `interval '30 days'` clause breaks the test.

## What's Next (09-04)

- 4 tool registry seeds: `acqu-tool-rls-test`, `acqu-tool-vault-rotate`, `acqu-tool-access-audit`, `acqu-tool-access-log-analyzer`.
- `customToolDispatch` handlers in `apps/runner/src/custom-tools.ts` that map the dispatched tool name to the function imported from `@agent-os/core`.
- `secrets-rotation` agent's cron schedule set in 09-05 seed (04:00 daily — Pitfall 2 enforcement).
