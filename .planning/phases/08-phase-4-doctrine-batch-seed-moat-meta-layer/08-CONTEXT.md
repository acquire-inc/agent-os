# Phase 8: Phase-4 doctrine batch seed (moat + meta-layer) — Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

## Phase Boundary

Seed the 22 Phase-4 doctrine agents — the moat (governance, compliance, knowledge-curation, pricing) and the meta-layer (agent management, evaluation). Pure data, mirroring the established Phase-2/5/6 seed pattern. No new application code beyond seed scripts + manifest.

The roster (22 agents):
- **v1 Phase 4 baseline (13)**: compliance-health, intel, decision-memo-drafter, save-play, expansion-finder, discovery-prep, call-summarizer, objection-coach, contract-drafter, payment-collector, unit-economics, agent-evaluator, agent-onboarder.
- **main §F Phase 4 additions (9)**: platform-change-watcher, regulatory-watcher, contract-lifecycle-manager, risk-register-keeper, knowledge-curator, skill-librarian, pricing-architect, discount-governor, reinvestment-advisor, forecast-runner.

## Workflow deviation (documented)

This phase deviates from the full plan-phase machinery (researcher → pattern-mapper → planner → checker → revision loop). Three prior phases (5, 6, and earlier 2) executed the *same* batch-seed pattern; the patterns + planner output would mechanically reproduce Phase 6's PLAN.md with 22 tasks instead of 12. The deviation is:

- **Researcher: kept.** Doctrine extraction is the only real research; the prompts are verbatim from /docs/.
- **Pattern-mapper: skipped.** The seed-script analog has been authored 3 times — `scripts/seed/acqu-*.ts` is the established template, `seedAgent(db, spec, { skillSource })` is the established helper, `scripts/seed/seed-phase-N.ts` is the established batch runner.
- **Planner subagent: replaced with inline PLAN.md mirroring Phase 6.** Tasks are mechanical (write 22 specs from RESEARCH.md + 1 batch runner + 1 manifest); a planner subagent would re-derive Phase 6's PLAN.md.
- **Plan-checker: replaced with the gsd-verifier at end.** The verifier's goal-backward check is the binding gate; pre-execution plan-checker would catch the same drift the verifier does, with one less round-trip.

This is a deliberate optimization for repeated patterns. The Phase-7 plan-phase took the full machinery (3 blockers caught at iteration 1, 0 at iteration 2). Phase 7 was novel infrastructure (Inngest + Browserbase + tools registry). Phase 8 is a 4th instance of an established mechanical pattern.

## Implementation Decisions

### Per-agent script shape
- **D-01:** Same per-agent shape as Phase 6: `scripts/seed/acqu-<key>.ts`, exports `<keyCamelCase>Spec: AgentSpec`, runs standalone via `runStandalone` guard or imported by batch.
- **D-02:** Imports identical to Phase 6: `TENANT_IDS`, `runStandalone`, `AgentSpec`.
- **D-03:** Prompts come VERBATIM from `08-RESEARCH.md`.

### Hard tier locks (T-critical agents — CLAUDE.md can't-fail list)
The seven Phase-8 agents on the can't-fail list MUST be `anthropic/claude-opus-4.8`. The script literal locks the model; this is the same defense as Phase 5's `ad-claim-compliance`:
- **D-04:** `contract-drafter` → opus-4.8
- **D-05:** `contract-lifecycle-manager` → opus-4.8
- **D-06:** `pricing-architect` → opus-4.8
- **D-07:** `discount-governor` → opus-4.8
- **D-08:** `decision-memo-drafter` → opus-4.8
- **D-09:** `reinvestment-advisor` → opus-4.8
- **D-10:** `risk-register-keeper` → opus-4.8

### Autonomy floor
- **D-11:** Action-taking / outbound / client-facing / can't-fail agents at `propose`. Includes: all 7 T-critical above, plus `payment-collector`, `discovery-prep`, `call-summarizer` (if it sends drafts), `objection-coach`, `save-play`, `expansion-finder`, `agent-onboarder`, `agent-evaluator` (proposes promotions/demotions), `knowledge-curator`, `skill-librarian`.
- **D-12:** Read-only / monitor agents at `execute_safe`. Includes: `compliance-health`, `intel`, `unit-economics`, `platform-change-watcher`, `regulatory-watcher`, `forecast-runner`.

### Bindings
- **D-13:** Skills by key (`verification-before-completion` on every agent as baseline; per-agent custom skill from doctrine).
- **D-14:** MCPs by exact name as registered in fixtures.ts.

### Batch runner + manifest + wiring
- **D-15:** `scripts/seed/seed-phase-4.ts` mirrors `seed-phase-3.ts` exactly.
- **D-16:** `pnpm seed:phase-4` at root + per-agent scripts in `scripts/seed/package.json`.
- **D-17:** `docs/acqu-phase-4-agent-manifest.md` mirrors Phase 1/2/3 manifest shape.

### Verification gate
- **D-18:** `pnpm -r typecheck` green. **D-19:** `pnpm --filter @agent-os/core run test:architect` 33/33. **D-20:** Verifier goal-backward check at end.

## Out of Scope

- **OOS-01:** SKILL.md authoring for new skill keys (e.g. `ftc-claim-review` was already deferred from Phase 5; `regulatory-impact-assess`, `case-modeling`, etc. — defer the same way).
- **OOS-02:** Live integration tests against Anthropic API. Verification is static (typecheck + architect regression + manifest review).
- **OOS-03:** Wiring `tool.browser` to its first consumer (creative-miner). That's Phase 8.5 or rolled into Phase 8 if creative-miner's spec wants it.

## Dependencies

- Phase 2 (seedAgent pattern), Phase 5 (ad-claim-compliance T-critical defense pattern + can't-fail enforcement model), Phase 6 (batch runner + manifest shape), Phase 7 (`agent_tools` join now exists — but Phase 8 agents bind no custom tools; tool.browser binding deferred).

## Success criteria (mirror Phase 6's shape)

1. `pnpm seed:phase-4` lands 22 agents idempotently in tenant Acqu's registry.
2. All 7 T-critical agents resolve to `anthropic/claude-opus-4.8`. Any deviation halts.
3. Action agents at `propose`; read-only/monitor agents at `execute_safe`.
4. `docs/acqu-phase-4-agent-manifest.md` mirrors the prior manifests.
5. `pnpm -r typecheck` green; architect regression 33/33.
