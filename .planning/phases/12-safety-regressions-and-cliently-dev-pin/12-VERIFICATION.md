---
phase: 12-safety-regressions-and-cliently-dev-pin
status: passed
verified: 2026-06-03
verifier: claude (inline)
---

# Phase 12 — VERIFICATION

## Outcome

PASSED. Two AgentOS safety regression tests committed on `cde191e`:
- `packages/core/src/architect/hydrate.immutability.test.ts` (61 assertions, all green)
- `packages/core/src/router/allowlist-parity.test.ts` (4 assertions, all green)
- `packages/core/package.json` scripts `test:immutability` and `test:parity` wired

## Must-haves

| Must-have | Met? | Evidence |
|---|---|---|
| `agents.key` immutability enforced by code and proven by test | ✓ | hydrate.immutability.test.ts group 3 asserts `out.agents[0].key === "monitor-ad-pacing"` after hydration with `inKey === "monitor-ad-pacing"` |
| `T_CRITICAL_ALLOWLIST` ↔ `T_CRITICAL_MODEL_ALLOWLIST` parity enforced | ✓ | allowlist-parity.test.ts fs-reads runner source, regex-extracts literal, asserts set-equality |
| Existing CANT_FAIL_KEYS membership (14 keys) pinned by explicit-list test | ✓ | hydrate.immutability.test.ts group 1 iterates `EXPECTED_CANT_FAIL` of 14 keys + negative-case assertion |

## Regression check (existing suites still green)

```
test:architect → 37 passed, 0 failed
test:cantfail  → 10 passed, 0 failed
test:router    → 25 passed, 0 failed
typecheck      → clean
```

## AgentOS scope honored

- No `hydrate.ts` edits — `CANT_FAIL_KEYS` stays at 14 entries
- No runner edits (`apps/runner/src/execute.ts` untouched)
- No CLAUDE.md edits
- No seed-script edits
- `cliently.dev` appears only in negative assertions and explanatory comments — proves it is NOT in the AgentOS can't-fail set

## Next phase unblocked

Phase 13 (5 candidate ATTACH operations) is now safe to execute: any skill-bundle mutation that accidentally rewrites `agent.key` will fail `test:immutability`; any drift between router and runner T-critical sets will fail `test:parity`.
