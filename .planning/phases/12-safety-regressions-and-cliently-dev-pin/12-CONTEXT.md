# Phase 12 — Safety Regressions + cliently.dev T-critical Pin

**Triggered by:** Phase 11 decisions (`11-03-DECISIONS.md`)
**Status:** proposed
**Type:** safety + drift-reconciliation

## Goal

Close two forward-looking safety regressions surfaced in Phase 11 code review (WR-06) and reconcile the pre-existing doctrine-vs-code drift on `cliently.dev` (WR-02) without touching production traffic.

## Scope-fence

**WRITE allowed:**
- `packages/core/src/architect/hydrate.ts` (add `cliently.dev` to `CANT_FAIL_KEYS`)
- `packages/core/src/architect/__tests__/` (new regression tests)
- `packages/core/src/router/__tests__/` (new parity test)
- `scripts/seed/cliently-dev.ts` (re-tier to T-critical; remove explicit `spec.model` if present)

**WRITE forbidden:**
- `tier-models.ts` (Hermes-demote NOT triggered — Path A held in Phase 11)
- `CLAUDE.md` model tier table (no Hermes changes)
- Any agent seed beyond `cliently-dev.ts`

## Three deliverables

1. **`agents.key` immutability test** — bundle hydration cannot mutate `agent.key` between seed and runner. Verifies the `assertCantFailModel` runtime gate cannot be bypassed by key-rewrite during hydration. Test: hydrate a T-critical bundle, attempt key mutation through every public hydration surface, assert key is frozen.

2. **`T_CRITICAL_ALLOWLIST` ↔ `T_CRITICAL_MODEL_ALLOWLIST` parity test** — router-side allowlist (the model slugs accepted as the T-critical pin) and runner-side allowlist (the slugs `assertCantFailModel` will accept) must match. Test: import both, assert set-equality, fail loud if drift.

3. **`cliently.dev` T-critical pin** — add `'cliently.dev'` to `CANT_FAIL_KEYS` in `hydrate.ts`. Re-seed: cliently.dev gets `modelTier: 'T-critical'`. Operator gate at execute time: `pnpm seed:phase-N` re-resolves model to Opus; `assertCantFailModel` covers cliently.dev going forward.

## Out of scope

- Phase 13's candidate ATTACH work (separate phase, separate plans)
- Any Hermes-tier change (Path A held; revisit only on eval failure)
- Phase 9 operator gates (still deferred)

## Acceptance

- 2 new tests pass and are visible in CI test count
- `cliently.dev` resolves to Opus through the Model Router (covered by a third targeted test)
- No production-fleet drift: every other agent's tier resolution unchanged
