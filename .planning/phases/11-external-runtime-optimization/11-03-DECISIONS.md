# Phase 11 — Operator Decisions

**Filled by:** <operator name>
**Date:** <date>
**Status:** <pending | recorded>

---

## Fork A: Hermes runtime-vs-model

**Recommended:** Path B (keep Anthropic Agent SDK runner; port gates/skills/KB; demote Hermes-4-* from `DEFAULT_TIER_MODELS`)

**Decision:** <Path A | Path B | other — explain>

**Sub-decision (if Path B):** demote Hermes-4-70b/405b in `DEFAULT_TIER_MODELS`?
- <Now (follow-up commit on claude/exciting-davinci-yvptm) | Staged (separate phase) | Keep as fallback only>

**Rationale:** <1-2 sentences from operator>

**Propagation list (if Path B + demote-now):**
- `CLAUDE.md` model tiering table (rewrite to reflect the runtime-not-model framing)
- `packages/core/src/router/tier-models.ts` `DEFAULT_TIER_MODELS["T-cheap"|"T-reason"]` (demote)
- `docs/plans/AGENT-OS-PLAN.md` Open Q #1 (add resolution note)
- 56 existing seed scripts: those currently on hermes-4-70b (9 agents) or hermes-4-405b (5 agents) get reseeded with the new tier-resolution at next `pnpm seed:phase-N`. No script edits required (Model Router re-resolves at seed time).

---

## Fork B: Isolation model

**Recommended:** Keep ours (RLS + single Supabase + 32-vector attack registry)

**Decision:** <Keep ours | Adopt theirs | Hybrid — explain>

**Rationale:** <1-2 sentences>

**If Hybrid:** what's the design space? (note: the Execution Plane section in AGENT-OS-PLAN is the adjacent space — ephemeral per-run sandboxed runner containers can give us closer-to-physical execution isolation without unwinding the DB-layer RLS contract)

---

## Per-candidate decisions (8 candidates)

For each candidate, record: KEEP-FOR-LATER (stays in `_candidates/`, no swap/attach now), SWAP (replace session stub), ATTACH (wire to specific agents), or DROP.

| Candidate | Recommended | Operator decision | Notes |
|---|---|---|---|
| `verification-before-completion-v2` | SWAP session stub | <KEEP-FOR-LATER \| SWAP \| DROP> | |
| `clarify-before-acting-v2` | SWAP session stub | <KEEP-FOR-LATER \| SWAP \| DROP> | |
| `prompt-injection-guardrail` | KEEP-FOR-LATER (attach to tool.browser agents post-Stagehand) | <KEEP-FOR-LATER \| ATTACH \| DROP> | |
| `output-quality-gate` | ATTACH (creative-studio, client-comms, weekly-report, content-engine) | <KEEP-FOR-LATER \| ATTACH \| DROP> | |
| `shadow-mode-discipline` | KEEP-FOR-LATER (surface as canonical) | <KEEP-FOR-LATER \| ATTACH \| DROP> | |
| `cost-ceiling-discipline` | KEEP-FOR-LATER (feeds Tier 2 reserve/commit) | <KEEP-FOR-LATER \| ATTACH \| DROP> | |
| `scope-lock-discipline` | ATTACH (ad-ops, launcher, content-engine) | <KEEP-FOR-LATER \| ATTACH \| DROP> | |
| `secret-scan-veto` | ATTACH (cliently.dev advisory) | <KEEP-FOR-LATER \| ATTACH \| DROP> | |

---

## Pre-existing drift to resolve before Phase 13

(Surfaced by the Phase 11 code-review — WR-02. This drift exists in the codebase BEFORE
Phase 11; the phase scope-fence forbids touching CLAUDE.md / hydrate.ts, so resolution
is parked on the operator. The decision below is the gate for Phase 13's
`secret-scan-veto` attach plan, which currently proposes attaching to `cliently.dev`.)

- **CLAUDE.md** lists `cliently.dev` (code-writing) in the can't-fail set.
- **`packages/core/src/architect/hydrate.ts`** `CANT_FAIL_KEYS` does **NOT** include `cliently.dev`.
- If doctrine is authoritative: attaching `secret-scan-veto` to `cliently.dev` is a T-critical violation; Phase 13 must drop that attach.
- If code is authoritative: doctrine is wrong; CLAUDE.md must be updated to remove `cliently.dev` from the can't-fail list.

**Decision:** <update CLAUDE.md to drop cliently.dev | update CANT_FAIL_KEYS to add cliently.dev | other — explain>

**Blocker for:** Phase 13 `secret-scan-veto` attachment to `cliently.dev` (advisory).

---

## Hard rules (re-affirmed for downstream phases)

- [ ] NO candidate is attached to ANY T-critical / CANT_FAIL_KEYS agent in any follow-up phase
- [ ] Branch `feat/external-skills-extraction` stays unmerged; per-candidate ATTACH/SWAP decisions are applied via separate commits to the working branch in follow-up phases
- [ ] License: NONE → reauthored never copied. If verbatim copy is detected in any candidate during operator review, that candidate is DROPPED
- [ ] WR-02 cliently.dev drift resolved BEFORE Phase 13 wires `secret-scan-veto`

---

## Downstream phases unblocked by these decisions

- **Phase 12 (proposed)** — Hermes-fork propagation (if Path B + demote-now decided): edit CLAUDE.md tier table, edit tier-models.ts DEFAULT_TIER_MODELS, edit AGENT-OS-PLAN Open Q #1, add regression test that any T-cheap or T-reason agent is NOT on Hermes-4-* unless explicit per-agent spec.model override.
  - [ ] **WR-06** — Phase 12 must also add an agents.key immutability regression test enforcing `agents.key` immutability through bundle hydration (so the `assertCantFailModel` runtime gate cannot be bypassed by a mutated bundle.agent.key). The reviewer confirmed the assertion is sound TODAY; this guarantees it stays sound under future runner changes.
  - [ ] **WR-06** — Phase 12 must also add a regression test enforcing parity between `T_CRITICAL_ALLOWLIST` (router) and `T_CRITICAL_MODEL_ALLOWLIST` (runner). If someone changes `tier-models.ts` to a different Opus slug without updating `execute.ts`, the assertion would fail-close all T-critical runs.
- **Phase 13 (proposed)** — Candidate swap/attach implementations (per-candidate decisions): replace session stubs, attach to specific non-T-critical agents, add tests. **Gated on WR-02 cliently.dev drift resolution above.**
- **Tier 2 backlog from OPTIMIZATION-AUDIT.md** — agent-evaluator scorecard implementation (inherits the A1-A5 + B1-B5 + critique.ts + learning.ts patterns from EXTERNAL-TEMPLATES-AUDIT column-b adoption), reserve/commit budget pattern (inherits cost-ceiling-discipline), CRA blocklist implementation (independent).
