# Acqu Phase-9 Agent Manifest

> **Precedence:** when this file conflicts with `main-acqu-agent-doctrine.md` on machinery, **main wins**.

Phase-9 doctrine batch seed — the security gate (tenant isolation, secrets rotation, access audit, anomaly detection). This is the prerequisite for any external multi-tenant launch per `main §6` HARD GATE #2.

## Hard tier lock — 4 / 4 T-critical agents

Every Phase-9 agent is on CLAUDE.md's can't-fail list. Their seed script LITERAL is `anthropic/claude-opus-4.8`. The `seed-phase-9` runner refuses to dispatch if ANY of them resolves to anything else (`HARD FAIL` exit). Per `docs/plans/AGENT-OS-PLAN.md` Open Q #1 (RESOLVED): **tier wins, override loses** — T-critical agents are EXEMPT from `tenants.default_model_override`. The runtime additionally emits `cantfail.model_violation` + fails closed if a T-critical agent is ever dispatched on a non-Opus model.

| Agent | Source |
|---|---|
| `tenant-isolation-tester` | v2 D5.3 (load-bearing safety check) |
| `secrets-rotation` | v2 D5.3 |
| `access-auditor` | v2 D5.3 |
| `security-anomaly-watchdog` | v2 D5.3 |

## Phase 9 roster (4 agents + 4 tools)

Run: `pnpm seed:phase-9`

Tools are seeded FIRST (S8: agent bindings need registry rows to exist), then the 4 agents.

### Tools

| # | Tool key | requiresApproval | reversible | Bound to |
|---|---|---|---|---|
| 1 | `tool.rls-test` | false | true | `tenant-isolation-tester` |
| 2 | `tool.vault-rotate` | **true** ← D-03 | false | `secrets-rotation` |
| 3 | `tool.access-audit` | false | true | `access-auditor` |
| 4 | `tool.access-log-analyzer` | false | true | `security-anomaly-watchdog` |

### Agents

| # | Agent | Tier | Model | Autonomy | Cron | Budget | Escalation |
|---|---|---|---|---|---|---|---|
| 1 | **`tenant-isolation-tester`** | **T-critical** | **`claude-opus-4.8`** | execute_safe | `30 4 * * *` | $1.50 | `tcritical:isolation_failure -> founder_p0` |
| 2 | **`secrets-rotation`** | **T-critical** | **`claude-opus-4.8`** | execute_safe | `0 4 * * *` | $0.50 | `tcritical:rotation_failed -> founder_p0` |
| 3 | **`access-auditor`** | **T-critical** | **`claude-opus-4.8`** | execute_safe | `0 5 * * 3` | $1.00 | `tcritical:orphan_grant -> founder_p1` |
| 4 | **`security-anomaly-watchdog`** | **T-critical** | **`claude-opus-4.8`** | execute_safe | `0 * * * *` | $0.30 | `tcritical:anomaly_high -> founder_p0` |

All 4: `thinkingLevel="high"`, `knowledgeScope={ folders:["security"], tags:["security"] }`, `mcpNames=["Slack"]`.

`secrets-rotation` autonomy stays at `execute_safe` — the propose-gating for CLIENT OAuth lives at the TOOL level (`tool.vault-rotate.requiresApproval=true`). PreToolUse hook 1c pauses for human approval per v2 D5.3 L1254. The agent dispatches; the tool gates.

`security-anomaly-watchdog` is `execute_safe` for ALERTS; lockdown actions stay `propose` (D-07 day-1 posture).

## Tier overrides vs. doctrine

Per `AGENT-OS-PLAN.md` Open Q #1 (RESOLVED):

- The operator may set `tenants.default_model_override` to `nousresearch/hermes-4-405b` for cost savings on non-critical tiers. **T-critical agents (this entire Phase 9 roster) IGNORE the override** — script literal `claude-opus-4.8` wins at seed time AND at runtime. The `seed-phase-9` eyeball table should show `claude-opus-4.8` on every row regardless of override state.
- If you see a Hermes model on any of the 4 rows after `pnpm seed:phase-9`, the seed exemption is broken — file a bug; do NOT proceed to HARD GATE.

## How to run

```bash
DATABASE_URL=...                # service-role for ops + seeds
AOS_VAULT_KEY=...               # hex-encoded AES-256 key (Phase 1 substrate)
pnpm seed:phase-9               # idempotent — seeds 4 tools + 4 agents

# Then, with a non-service-role connection + 2 pre-seeded tenants:
RLS_TEST_DATABASE_URL=...       # authenticated-role; service-role would false-pass
RLS_TEST_USER_A=<uuid>          # member of tenants.acqu
RLS_TEST_USER_B=<uuid>          # member of tenants.cliently
pnpm verify:isolation-live      # HARD GATE #2 — exit code = gate status
```

The seed runner hard-fails BEFORE touching the DB if any T-critical model literal is wrong. Idempotent.

## HARD GATE #2 — External launch block

Per `main §6` + `CLAUDE.md` non-negotiable #5: **no external multi-tenant launch until `tool.rls-test` runs against live Supabase with ≥2 tenants and reports ZERO cross-tenant leaks.**

Pass criteria:
- `pnpm verify:isolation-live` exits 0 with `passed: true`.
- Every positive control returned ≥1 row (proves the test was wired, not silently false-passing per D-01 + Pitfall 5).
- `results.json` shows 0 vectors with `actual > 0`.

False-pass detection — REJECT a "pass" if:
- The script exits in milliseconds with `count=N passed=true` and no per-vector log lines were printed (likely your `RLS_TEST_DATABASE_URL` is service-role).
- Any vector throws `"wiring broken: tenant X can't see itself"` — the positive control failed, the impersonation transaction is set up wrong.

Failure routing: each leak corresponds to an RLS policy gap on the named table. Fix the policy (new migration), re-seed if needed, re-run the gate. Do NOT mark the gate green until the pass is real.

## B-phase verification entry point

- All 4 T-critical agents resolve to `anthropic/claude-opus-4.8` in the eyeball table (even with tenant override set — exemption per Open Q #1 RESOLVED).
- 4 grep gate: `grep -l '"anthropic/claude-opus-4.8"' scripts/seed/acqu-{tenant-isolation-tester,secrets-rotation,access-auditor,security-anomaly-watchdog}.ts | wc -l` returns 4.
- `pnpm -r typecheck` green; architect 37+/37+ green.
- `pnpm verify:isolation-live` exits 0 against a live 2-tenant Supabase.
