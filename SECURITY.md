# Security Posture

This document is the operator/auditor/internal-customer reference for how
AgentOS protects tenants, agents, and data.

## Threat model summary

| Threat | Mitigation | Where |
|---|---|---|
| Cross-tenant read | RLS on every table + tenant-isolation tester (32 attack vectors) + defense-in-depth row filter in data layer | `packages/tool-rls-test/`, `packages/control-plane/src/lib/data.ts:sb()` |
| Cross-tenant agent handoff | Refused at decision layer + RLS on `agent_handoffs` | `packages/core/src/a2a.ts:decideHandoff` |
| Compromised T-critical model selection | Opus pin, override-exempt, runtime fail-closed with `cantfail.model_violation` | `packages/core/src/router/resolve.ts`, runner SessionStart guard |
| CRA eligibility decisioning | Hardcoded keyword + category blocklist; two enforcement points (hydrate refusal + runtime SessionStart guard); auto-onboarding interview pre-check | `packages/core/src/architect/cra-blocklist.ts`, `packages/core/src/onboarding.ts` |
| Prompt injection via tool output | `injection-guard.ts` scrubs every external-trust tool dispatch (6 detection categories); per-run autonomy ratchet to `propose` on detect | `packages/core/src/security/injection-guard.ts`, `apps/runner/src/run-state.ts` |
| Runaway budget | Per-run reserve/commit/release + DB-persisted reservations + restart hydrate + per-tool reserve + per-tenant monthly cap | `packages/core/src/budget/`, mig 0018, mig 0025 |
| Approvals bypass | First-decision-wins idempotency guard on approvals; double-submit returns the prior decision | `apps/control-plane/src/lib/approval-store.ts` |
| Critic peer-approval abuse (self-vote, etc.) | Self-vote guard at qualify + at tally (defense-in-depth); cant-fail proposers never eligible | `packages/core/src/critic.ts` |
| Lease conflict / overlap | Lease arbitration with UNIQUE partial index on active leases; cant-fail preempts non-cant-fail; cant-fail vs cant-fail never preempts | `packages/core/src/lease.ts`, mig 0029 |
| Operator misconfiguration (typo'd model, bad threshold) | Tenant config validators reject malformed payloads with knob-prefixed reasons + UI pre-flight | `packages/core/src/tenant-config.ts` |
| Stale or in-flight runs after runner crash | Lease TTL auto-expiry + budget reservation hydrate on boot | `packages/core/src/lease.ts:clampLeaseTtl`, `apps/runner` |
| Autonomy escalation by an agent's own prompt | Autonomy gate enforced in SDK hooks (PreToolUse/PostToolUse/Stop/SessionEnd) — prompt cannot bypass | `packages/core/src/autonomy.ts`, `apps/runner/src/hooks.ts` |
| Cantfail agent paused/retired without operator | Manager refuses to act on cant-fail agents; operator-only | `packages/core/src/manager.ts:decideManagerAction` |

## Cantfail floor

14 agent keys are pinned to `claude-opus-4.8`, override-exempt, fail-closed
at SessionStart. The list is doctrine, not config — operators cannot add
to or remove from it via the UI. Source of truth:
`packages/core/src/architect/hydrate.ts:CANT_FAIL_KEYS`. The launch-check
script verifies the count is 14 on every build.

## CRA prohibition

Eligibility-decisioning categories (credit · employment · housing/tenant
screening · insurance underwriting · government benefits) are refused at
THREE enforcement points:

1. **Auto-onboarding pre-check** — interview validator flags trigger
   keywords in description/goals/industry; operator must explicitly
   confirm non-eligibility before onboarding proceeds.
2. **Architect hydrate refusal** — blueprint generation refuses any agent
   whose key or function matches the blocklist; emits `architect.refused`.
3. **Runner SessionStart guard** — manually-authored agents that bypassed
   the architect refusal trip `cantfail.cra_violation` at runtime; run
   fails closed.

No per-tenant override. Global invariant.

## Tenant isolation testing

The `packages/tool-rls-test` package registers 32 attack vectors (frozen,
append-only). Static suite runs on every push; live verification suite
(`scripts/verify/isolation-live.ts`) is the HARD GATE for external launch
— no external tenant may register until the live suite returns zero
cross-tenant rows on every vector.

## Audit trail

Every load-bearing decision emits a relay event. Operator can answer
"what happened, when, why" by querying `relay_events`:

| Event class | What it answers |
|---|---|
| `model.routed` | Why this run used this model |
| `cantfail.*` | When a safety invariant was nearly violated (or was) |
| `budget.*` | Per-run reserve/commit/release + tenant cap breaches |
| `architect.refused` | When the Architect refused a CRA-territory blueprint |
| `agent.lease_decided` | Lease grant/conflict/preempt — "agent X held off by Y on resource Z" |
| `agent.handoff_decided` | A2A chain steps + refused handoffs |
| `critic.quorum_decided` | Peer auto-approvals and escalations |
| `objective.reflexion_decided` | Retry/complete/abandon on objectives |
| `improvement.proposed` | Self-improvement prompt amendments queued |
| `manager.action_proposed` | Autonomous pause/retire proposals |
| `anomaly.circuit_tripped` | Real-time autonomy demotion on failure streak |

Registry is append-only and lowercase-dotted, verified by `pnpm launch:check`.

## Secrets handling

- Connector OAuth credentials encrypted in `connectors_vault` (AOS_VAULT_KEY).
- API keys hashed (never stored plaintext); admin keys carried in
  `localStorage` of the operator UI only.
- No secrets in agent prompts (vault refs only).
- Cant-fail `secrets-rotation` agent is on the cant-fail list — touches
  vault credentials, fails closed.

## Migrations are additive

All migrations 0001–0031 are additive (verified). No drop-column, no
drop-table. Rollback is the inverse DROPs in `docs/migration-rollback-notes.md`.
Data loss on rollback is bounded to derived/operational data (scorecards,
proposals, leases, reservations) — not customer business data.

## Kill switches

V2 self-improvement loops can be disabled via env vars (default ENABLED):
`AOS_FEATURE_<NAME>_DISABLED=1`. See `docs/feature-flags.md`. **Cannot be
disabled**: cant-fail floor, CRA blocklist, prompt-injection guard, budget
caps, RLS. Those are invariants, not features.

## Operator gates for external launch

1. `pnpm verify:isolation-live` — must PASS against the live DB.
2. `dunning-manager` doctrine agent must be seeded (recurring-billing gate).
3. `ad-claim-compliance` agent must be seeded (client ad launch gate).
4. Legal sign-off on the CRA wording in the blocklist (pending counsel).

All three are documented as **hard gates** in CLAUDE.md.

## Reporting a security issue

Internal — file in #security. We treat anything that violates an
invariant above as a Sev-1.
