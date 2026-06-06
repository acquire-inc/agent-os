# Phase 17 — Per-Task Model Tiering (PLAN + DONE)

> **Operator decision (2026-06):** lift the single-model override; deploy the optimal model per task,
> no single-model dependency. GSD plan→execute→review→verify. Model is config, not code.

## Decision → mapping
| Tier | Model | Rationale |
|---|---|---|
| T-cheap | `nousresearch/hermes-4-70b` | volume monitors/triage — cheap, always-on |
| T-reason | `nousresearch/hermes-4-405b` | multi-step reasoning/synthesis workhorse |
| T-work | `anthropic/claude-sonnet-4.6` | reliable agentic tool orchestration / client-facing |
| T-critical (non-can't-fail) | `anthropic/claude-sonnet-4.6` | high-stakes, never Hermes |
| **can't-fail** | `anthropic/claude-opus-4.8` | judgment + safety — **Opus reserved exclusively for this set** |

## Done
- **Central policy** (`_shared.ts`): `Tier`, `MODEL_FOR_TIER`, `CANT_FAIL_MODEL`, `modelForAgent(key,tier)`
  (can't-fail → Opus/never-Hermes; else tier model), `isCantFailOnHermes`. `ACQU_AGENT_MODEL` kept as
  a back-compat alias (= T-reason), no longer an override.
- **Insert-time routing:** `_generic.ts` (roster) + all 10 dedicated `acqu-*.ts` set
  `model = modelForAgent(key, tier)`.
- **Removed the 3 blanket normalizations** (seed-everything / seed-remaining-phases / seed-phase-1);
  replaced with per-tier verification + the safety invariant "can't-fail never on Hermes" + a model
  distribution report.
- **Seed-time validation** (`_schema.ts`): `validateAgent` rejects any can't-fail agent on a Hermes slug.
- **Gates:** `readiness.test` (author-time) + `verify-golive` (DB-time) both assert can't-fail-never-Hermes.
- **Defense-in-depth preserved:** the autonomy ceiling for can't-fail is unchanged — they now have
  BOTH Claude Opus AND the `propose` gate.
- **Doctrine:** CLAUDE.md override banner + can't-fail model-policy resolution rewritten; GO-LIVE-READINESS
  + STATE updated.

## Verify
`_model-tiering.test` 12/12; full agent-scope sweep green; typecheck clean. Code-review run on the
refactor; findings folded in.

## Note (left as-is, by design)
`model-fallback.ts` keeps Hermes→Haiku only (Claude models have no fallback). Can't-fail/Opus must
fail closed, not silently degrade — so no fallback for them is correct.
