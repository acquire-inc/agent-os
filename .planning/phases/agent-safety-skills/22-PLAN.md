# Phase 22 — Tool-coverage surfacer (PLAN)

GSD-style cycle (plan → execute → code-review → verify), run with the built-in equivalents since
GSD/no-mistakes aren't installed in this sandbox.

## Goal
Go-live visibility: given referenced tool keys, report which have a real implementation (the core
dispatcher) vs. which are still catalog stubs — so we know exactly which Wave-2 tools remain before
the agents that depend on them can fully function.

## Plan
- `toolCoverage(toolKeys)` in `custom-tools.ts`: partition into `implemented` / `stub`, with a
  coverage ratio. Pure.
- Test it (implemented set recognized, stubs listed, ratio correct).

## Review
- Run the `code-review` skill on the diff (the no-mistakes-equivalent pre-land gate); fix findings.

## Verify
- core sweep green; typecheck clean.
