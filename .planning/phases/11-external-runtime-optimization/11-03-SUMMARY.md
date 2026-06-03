---
phase: 11-external-runtime-optimization
status: closed
closed: 2026-06-03
decisions_recorded: 11-03-DECISIONS.md
review_status: clean (0 findings after 13/13 patches verified)
---

# Phase 11 — Summary

## Outcome

Phase 11 (External Runtime Optimization) closed clean. The phase ran read-only survey + planning + quarantined skill extraction on the `agentic-templates-restructure-v2-stack-alignment` external runtime without touching any live-fleet code. All operator decisions are now recorded in `11-03-DECISIONS.md`.

## Waves delivered

| Wave | Deliverable | Commit | Push status |
|---|---|---|---|
| Wave 1 | `EXTERNAL-RUNTIME-RECONCILIATION.md` (2058 words) + `EXTERNAL-TEMPLATES-AUDIT.md` (3102 words) | `251f142` | pushed |
| Wave 2 | 8 quarantined SKILL.md candidates + `SKILLS-EXTRACTION-REPORT.md` on `feat/external-skills-extraction` | `3eb2bff` | LOCAL-ONLY (upstream 503; retry pending) |
| Wave 3 | `11-03-DECISIONS.md` template + filled decisions | `ef5a4c4` + this commit | pushed |

## Decisions recorded

**Fork A (Hermes):** Path A — keep current architecture. Hermes-4-70b/405b retained in T-cheap and T-reason; runtime stays Anthropic Agent SDK. No fleet-wide demote. Per-agent `spec.model` override is the eval-promotion lever if any individual agent fails.

**Fork B (Isolation):** Keep ours — RLS + `is_tenant_member()` SECURITY DEFINER + 32 attack-vector tester. External runtime's per-tenant runtime separation is orthogonal; the ephemeral-container execution-plane idea stays on Tier 2 backlog as additive.

**Per-candidate (8 candidates):**
- 2 KEEP-FOR-LATER: `verification-before-completion-v2`, `clarify-before-acting-v2` (existing coverage already shipped in optimization audit Tier 1)
- 6 ATTACH (queued for Phase 13): `prompt-injection-guardrail`, `output-quality-gate`, `shadow-mode-discipline`, `cost-ceiling-discipline`, `scope-lock-discipline`, `secret-scan-veto`
- 0 DROP, 0 SWAP (session stubs left intact)

**WR-02 drift (cliently.dev):** Code follows doctrine. Phase 12 adds `cliently.dev` to `CANT_FAIL_KEYS` in `packages/core/src/architect/hydrate.ts` and re-seeds with T-critical tier.

## Code review

- Initial review: 13 findings (2 BLOCKER, 7 WARNING, 4 INFO)
- All 13 patched on commit `f5186bb` (deeper-route mandate)
- Re-review (`11-REVIEW.md`): 0 findings, status clean, READY for execute-phase
- WR-06 forward-looking risks (agents.key immutability + T_CRITICAL_ALLOWLIST parity) folded into proposed Phase 12

## Scope-fence honored

All 13 patches and all 4 plan files landed inside `.planning/phases/11-external-runtime-optimization/`. No edits to `scripts/seed/`, `external/acqu-skills/`, `CLAUDE.md`, `packages/core/src/router/tier-models.ts`, or `packages/core/src/architect/hydrate.ts`. Operator gates 1-3 (`supabase db push`, `pnpm seed:phase-9`, `pnpm verify:isolation-live`) remain deferred — enforced by-construction (sandbox lacks Supabase service-role credentials; no plan shell-injects them).

## Pending operational items

- [ ] Wave 2 push retry: `feat/external-skills-extraction` at `3eb2bff` is local-only — retry when upstream proxy heals
- [ ] Operator gates 1-3 still deferred (Phase 9 migrations + seed + isolation-live)

## Downstream phases unblocked

- **Phase 12 (proposed)** — Safety regressions + cliently.dev T-critical pin (3 items)
- **Phase 13 (proposed)** — 6-candidate ATTACH implementation (1 item per candidate + tests)
- **Tier 2 backlog** — unchanged

---

_Closed: 2026-06-03_
_Decisions: 11-03-DECISIONS.md_
_Review: 11-REVIEW.md (clean)_
