# Phase 9: tenant-isolation-tester + secrets-rotation (external launch gate) — Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

## Phase Boundary

Ship the 4 can't-fail security agents that gate external Cliently launch (main §6 hard gate #2), plus the 3 deterministic tools they invoke. Real infrastructure work — not seed-only.

The roster:
- `tenant-isolation-tester` — runs cross-tenant RLS checks; phase HARD GATE.
- `secrets-rotation` — rotates expiring vault credentials; signals connector-health on rotation.
- `access-auditor` — flags orphaned grants (departed humans, churned tenants, archived agents).
- `security-anomaly-watchdog` — pattern detection across `audit_log` + `autonomy_events`.

Plus three new tools:
- `tool.isolation-test-suite` (or `tool.rls-test`) — runs RLS positive + negative controls.
- `tool.vault-auditor` / `tool.vault-rotate` — token TTL sweep + rotation.
- `tool.access-log-analyzer` — anomaly + orphan detection over audit logs.

## Implementation Decisions

### D-01: `DATABASE_URL` role for RLS tests
The test suite MUST run against a NON-service-role connection. Service-role bypasses RLS, which would make every cross-tenant test trivially pass false (Pitfall 1).

**Decision:** the RLS test tool opens its own connection with the `authenticated` role (Supabase anon-style), sets `auth.uid()` per-test via SET LOCAL, and verifies cross-tenant queries return zero rows. The runner's main DATABASE_URL stays service-role for normal operations. The test tool takes a separate `RLS_TEST_DATABASE_URL` env var.

### D-02: `tool-rls-test` packaging
**Decision:** `packages/tool-rls-test` (own package) — mirrors `packages/tool-browser` shape. Three reasons: (a) the RLS test logic is non-trivial (per-table positive + negative + as-authenticated-user controls); (b) it needs its own dev dependency on `postgres` for the separate connection; (c) Phase 7's tool-browser established the workspace-package convention for runner-side deterministic tools.

### D-03: Vault rotation scope
**Decision:** Ship the rotation framework + a Close OAuth refresher as reference impl. Meta + Stripe refreshers stub out with `throw new Error("operator: implement provider refresher")` so the agent fails closed, not silently. The operator (or the agent-building session) wires the remaining providers as needed. This honors "ship the substrate; the agents bind to it."

### D-04: Hermes-vs-Opus for can't-fail
The 4 Phase-9 agents are on the can't-fail list (CLAUDE.md). Per Phase-8.5 precedent:
- Script literals: `anthropic/claude-opus-4.8` (doctrine intent preserved; audit trail).
- Tenant override (set by operator in Phase 8.5): rewrites at seed time to `nousresearch/hermes-4-405b`.
- Reversible by clearing `tenants.default_model_override`.

Same tradeoff already documented in `docs/HANDOFF-other-session.md`. Operator made the call with eyes open.

### D-05: Security findings storage
**Decision:** New `security_findings` table (migration 0010). Captures isolation-test results, rotation events, orphan flags, anomaly detections. RLS-protected like every other tenant-scoped table.

### D-06: Hard gate semantics
The phase only "passes" if `tool.isolation-test-suite` reports ZERO cross-tenant row leaks across every tenant-scoped table, including positive controls (queries that SHOULD return rows when called as the right tenant). Without that, Phase 10 (external Cliently launch) is blocked.

### D-07: Anomaly-watchdog false positives
**Decision:** Watchdog at autonomy `execute_safe` (alerts only, never blocks). Day-1 thresholds intentionally loose (high false-positive rate acceptable). Tightening happens via agent-evaluator scorecard once 30 days of operator-marked-noise vs operator-acknowledged data exists.

### D-08: Verification gate
- `pnpm -r typecheck` green.
- `pnpm --filter @agent-os/core run test:architect` 33/33 (regression).
- `pnpm --filter @agent-os/tool-rls-test test` — RLS positive+negative controls all green against the sandbox seed dataset.
- Phase 10 entry gate: an isolation-test run dispatched against live Supabase with 2+ tenants returns ZERO cross-tenant leaks.

## Out of Scope

- **OOS-01:** Cliently external launch itself (Phase 10).
- **OOS-02:** Meta + Stripe OAuth refresher implementations (the framework + Close reference ship; rest stub out).
- **OOS-03:** Live security-anomaly-watchdog tuning (will iterate after first 30 days of real data).
- **OOS-04:** Penetration testing / external security audit (separate engagement).

## Dependencies

- Phase 1 (0001 RLS policies via `is_tenant_member()` — the thing being tested).
- Phase 5 (T-critical defense pattern from `ad-claim-compliance` — replicate for all 4 here).
- Phase 7 (`customToolDispatch` registry — the 3 new tools register the same way `tool.browser` does).
- Phase 8.5 (lifecycle states — `access-auditor` checks for grants tied to `archived` agents).

## Success criteria

1. 4 doctrine agents seeded as data (`pnpm seed:phase-9`), all with script-literal model = `claude-opus-4.8` and autonomy enforced per doctrine.
2. 3 new tools registered + runner-dispatched + bound to the right agents.
3. Migration 0010 (`security_findings`) lands with RLS.
4. RLS test suite runs against sandbox and all assertions pass (positive controls hit; negative controls return zero rows).
5. `pnpm -r typecheck` green; architect 33/33; tool-rls-test green.
6. Operator dispatches `tool.isolation-test-suite` against live Supabase — ZERO cross-tenant leaks. This is the hard gate that unblocks Phase 10.
