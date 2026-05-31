# Phase 8: Phase-4 doctrine batch seed (moat + meta-layer) — Plan

**For agentic workers:** Use the executing-plans discipline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed the 22 Phase-4 doctrine agents as DATA via the same `seedAgent(db, spec)` pattern used in Phases 2, 5, and 6. No new application code.

**Architecture:** Per-agent `scripts/seed/acqu-<key>.ts` (data) + `scripts/seed/seed-phase-4.ts` (batch runner) + `docs/acqu-phase-4-agent-manifest.md` (operator manifest). Every prompt is verbatim from `08-RESEARCH.md`.

**Tech Stack:** TypeScript (strict), `@agent-os/core` (`seedAgent`), `@agent-os/shared` (`TENANT_IDS`). Zero new deps.

## Hard tier lock (the safety contract — repeated from Phase 5)

These 7 agents are on CLAUDE.md's can't-fail list. The seed script LITERAL must be `anthropic/claude-opus-4.8`. NEVER Hermes. Any PR changing one of these lines should be rejected:
- contract-drafter
- contract-lifecycle-manager
- pricing-architect
- discount-governor
- decision-memo-drafter
- reinvestment-advisor
- risk-register-keeper

## Task 1: Per-agent seed scripts (22 files)

Each script: header comment with doctrine source + tier + autonomy rationale → verbatim prompt from `08-RESEARCH.md` → exported `AgentSpec` → `runStandalone` guard.

- [ ] **Step 1**: Write the 22 `scripts/seed/acqu-*.ts` files (one per roster member). Use the Phase 6 templates (`acqu-launcher.ts` is the canonical shape) — only the SYSTEM_PROMPT, model, autonomy, cron, skills, MCPs, and budget differ.

## Task 2: Batch runner

- [ ] **Step 1**: Write `scripts/seed/seed-phase-4.ts` — imports all 22 specs, iterates via `seedAgent(db, spec, { skillSource: SKILL_SOURCE })`, prints the eyeball table. Mirror `seed-phase-3.ts` exactly.

## Task 3: pnpm wiring

- [ ] **Step 1**: Add 22 per-agent scripts + `phase-4` to `scripts/seed/package.json`.
- [ ] **Step 2**: Add `seed:phase-4` to root `package.json`.

## Task 4: Manifest

- [ ] **Step 1**: Write `docs/acqu-phase-4-agent-manifest.md` mirroring Phase 1/2/3/6 manifest shape — with a hard-gate callout for the 7 T-critical agents.

## Task 5: Verify + commit + push

- [ ] **Step 1**: `pnpm -r typecheck` — expected all 12 packages Done with no errors.
- [ ] **Step 2**: `pnpm --filter @agent-os/core run test:architect` — expected `Results: 33 passed, 0 failed`.
- [ ] **Step 3**: Verify T-critical model lock: 7 grep hits for `"anthropic/claude-opus-4.8"` across the 7 can't-fail scripts.
- [ ] **Step 4**: Write `08-VERIFICATION.md` (gsd-verifier).
- [ ] **Step 5**: Commit + push.

## Done when

- 22 new per-agent seed scripts + 1 batch runner committed.
- `pnpm seed:phase-4` wired at root.
- `pnpm -r typecheck` green; architect 33/33.
- 7 T-critical agents lock to `claude-opus-4.8` (grep gate).
- Manifest exists.
- gsd-verifier PASS.
