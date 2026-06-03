# Phase 15 — Prompt-injection guard runtime layer

**Triggered by:** Phase 13's `prompt-injection-guardrail` skill assumes a runtime mechanical layer
**Status:** complete (executed inline)
**Type:** safety / runtime hardening

## Goal

Ship the mechanical layer the Phase 13 `prompt-injection-guardrail` SKILL.md doctrine assumes: scrub directive-shaped spans from tool-returned content (browser scrapes today; connector fetches as they land) before the planner reads them.

## Delivered

- `packages/core/src/security/injection-guard.ts` — pure scrub module
  - `scrubInjections(text)` — pattern bank (6 categories × multiple regexes), redaction with structural-preservation markers, overlap de-dup
  - `scrubToolResult(unknown)` — convenience wrapper that unwraps strings and shallow objects
  - 6 detection categories: `direct_override`, `role_shift`, `steganographic`, `envelope_mimicry`, `exfiltration`, `tool_coercion`
- `packages/core/src/security/injection-guard.test.ts` — 58 assertions across 7 groups
- `apps/runner/src/custom-tools.ts` — `tool.browser` handler now scrubs results before returning
- Exported from `@agent-os/core` and wired into `package.json` scripts

## Scope

WRITE: `packages/core/src/security/injection-guard.ts(.test.ts)`, `packages/core/src/index.ts`, `packages/core/package.json`, `apps/runner/src/custom-tools.ts`
NOT touched: T-critical seeds, skill files, CLAUDE.md, hydrate.ts, tier-models.ts

## Acceptance ✓

- `pnpm --filter @agent-os/core test:injection` → 58 passed, 0 failed
- All 6 categories detected on known-bad samples
- 4 benign samples pass through unscrubbed
- Runner typecheck clean
- Phase 12, 14 regressions still green

## Out of scope

- The `finding.recorded` emission on detection (deferred to a follow-up — the warn log captures the signal today; Relay event hookup needs a runtime-tenant context)
- Autonomy ratchet on detection (the doctrine specifies "ratchet down to propose"; this requires a runner-state field that the autonomy gate reads — separate phase)
- LLM-based semantic injection detection (Tier 2)
