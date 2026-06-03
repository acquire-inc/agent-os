# Phase 12 — AgentOS Safety Regressions

**Triggered by:** Phase 11 decisions (`11-03-DECISIONS.md`)
**Status:** proposed
**Type:** safety regression hardening (AgentOS only)

> NOTE: Phase originally titled "Safety Regressions + cliently.dev T-critical Pin". The cliently.dev pin was dropped — cliently.dev is the productized client-facing offering (Cliently product), not an AgentOS internal agent. Phase scope is now AgentOS safety only. The directory name retains the old slug for git-history continuity; treat the canonical title as "AgentOS Safety Regressions".

## Goal

Close two forward-looking safety regressions surfaced in Phase 11 code review (WR-06). Both are AgentOS-internal hardening that pin existing safety invariants with regression tests, so future refactors fail loud at CI time instead of in production.

## Scope-fence

**WRITE allowed:**
- `packages/core/src/architect/hydrate.immutability.test.ts` (new)
- `packages/core/src/router/allowlist-parity.test.ts` (new)
- `packages/core/package.json` (add 2 new `test:*` script entries)

**WRITE forbidden:**
- `packages/core/src/architect/hydrate.ts` (no CANT_FAIL_KEYS edits — cliently.dev removed from scope)
- `tier-models.ts` (Hermes-demote NOT triggered — Path A held in Phase 11)
- `CLAUDE.md` (no doctrine edits this phase)
- `apps/runner/src/execute.ts` (parity test catches drift; no runner refactor needed)
- Any agent seed in `scripts/seed/`

## Two deliverables

1. **`agents.key` immutability test** — bundle hydration cannot mutate `agent.key` between seed and runner. Verifies the `assertCantFailModel` runtime gate cannot be bypassed by key-rewrite during hydration. Test: hydrate a non-can't-fail blueprint, assert output `agent.key` matches input `blueprint.key` byte-for-byte. Also asserts the 14-key `CANT_FAIL_KEYS` membership is intact (catches accidental additions/removals).

2. **`T_CRITICAL_ALLOWLIST` ↔ `T_CRITICAL_MODEL_ALLOWLIST` parity test** — router-side allowlist (model slugs accepted as the T-critical pin) and runner-side allowlist (slugs `assertCantFailModel` will accept) must match. Test: import router allowlist, fs-read runner literal, regex-extract, assert set-equality.

## Out of scope

- cliently.dev anything (separate Cliently product track)
- Phase 13's candidate ATTACH work (separate phase, separate plans)
- Any Hermes-tier change (Path A held)
- Phase 9 operator gates (still deferred)

## Acceptance

- 2 new test files exist, each wired into `package.json` scripts
- Both `pnpm --filter @agent-os/core test:immutability` and `pnpm --filter @agent-os/core test:parity` exit 0
- No production-fleet drift: existing tests (`test:architect`, `test:cantfail`, `test:router`) still pass
- `pnpm --filter @agent-os/core typecheck` is clean
