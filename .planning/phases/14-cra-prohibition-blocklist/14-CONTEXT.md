# Phase 14 — CRA Prohibition Blocklist (HARD GATE for public launch)

**Triggered by:** CLAUDE.md doctrine — "no public/self-serve tenant until CRA blocklist is in place"
**Status:** proposed
**Type:** safety / hard gate

## Goal

Implement the CRA (Consumer Reporting Act) prohibition blocklist that the doctrine requires before any external/self-serve tenant. The Relay namespace already reserves `architect.refused` and `cantfail.cra_violation`; this phase ships the enforcement.

## Doctrine (verbatim from CLAUDE.md)

> The Architect MUST refuse to assemble any agent whose function touches eligibility decisioning in: **credit · employment · housing/tenant screening · insurance underwriting · government-benefit determination**. Code-enforced (keyword + category match in `packages/core/src/architect/cra-blocklist.ts`), fails closed, emits `architect.refused` (Relay event). Runtime guard at the runner — even manually-authored seeds bypassing the architect — emits `cantfail.cra_violation` + fails closed. List is a global invariant; `tenants.feature_flags` cannot disable it.

## Scope-fence

**WRITE allowed:**
- `packages/core/src/architect/cra-blocklist.ts` (new module — the blocklist + check predicate)
- `packages/core/src/architect/hydrate.ts` (call the predicate before assembly)
- `packages/core/src/architect/cra-blocklist.test.ts` (new tsx test)
- `apps/runner/src/execute.ts` (add `assertNotCraProhibited` belt-and-suspenders guard at SessionStart)
- `packages/core/src/index.ts` (export new module surfaces)
- `packages/core/package.json` (add `test:cra` script)

**WRITE forbidden:**
- `tenants` table schema (CLAUDE.md: list is a global invariant — no per-tenant override)
- CLAUDE.md doctrine (already correct)
- Any agent seed (the blocklist applies at hydrate / dispatch time, not at seed time — existing seeds are grandfathered if they don't trip the predicate)

## Five deliverables

1. **Blocklist module** — `packages/core/src/architect/cra-blocklist.ts` exports:
   - `CRA_CATEGORIES`: readonly array of the 5 categories
   - `CRA_KEYWORDS`: readonly array of trigger keywords grouped by category
   - `checkCraProhibition(text: string): { prohibited: boolean; category: string | null; matchedKeyword: string | null }` — case-insensitive keyword match against the input text
   - `assertNotCraProhibited(text: string, source: string): void` — throws `CraProhibitionError` on prohibited match

2. **Architect refusal at hydrate time** — `hydrate.ts` calls `assertNotCraProhibited(blueprint.role + " " + blueprint.systemPrompt, "architect:" + blueprint.key)` per blueprint. On match, the blueprint is skipped (consistent with the existing can't-fail refusal pattern), a warning is appended, and the caller emits `architect.refused` with the matched category.

3. **Runtime guard at SessionStart** — `apps/runner/src/execute.ts` adds `assertCraNotProhibited(bundle)` alongside the existing `assertCantFailModel(bundle)` check. Inspects `bundle.agent.systemPrompt` (read-only — the runner doesn't have role text but the system prompt is enough). On match, emits `cantfail.cra_violation` and returns a terminal `run.failed`.

4. **Tests** — `packages/core/src/architect/cra-blocklist.test.ts` covers:
   - Every category has at least 5 trigger keywords
   - Each known-bad sample (one per category) triggers the predicate
   - Known-good samples (lookalike phrases that mention "credit" in non-eligibility contexts, e.g. "credit the customer's account" for revenue ops) do NOT trigger
   - `assertNotCraProhibited` throws `CraProhibitionError` with the category populated
   - `assertNotCraProhibited` on clean text does not throw

5. **Architect integration test** — extend `architect.test.ts` (or sibling) to assert hydrate refuses a CRA-touching blueprint with the proper warning category and does NOT touch the existing 14-key can't-fail flow.

## Out of scope

- Per-tenant override (doctrine forbids it)
- LLM-based semantic check (Tier 2; keyword check is the floor)
- Legal sign-off on the exact wording of the categories (operator decision, not a code change)
- Public/self-serve tenant onboarding flow (separate phase once the gate is live)

## Acceptance

- `pnpm --filter @agent-os/core test:cra` exits 0
- A blueprint with role text "decide credit eligibility for loan applicants" is refused; the warning names category `credit`
- A blueprint with role text "credit the customer's deposit to the right ledger" is NOT refused (lookalike protection)
- `cantfail.cra_violation` and `architect.refused` are both emitted from the appropriate code paths
- Existing `test:architect`, `test:cantfail`, `test:immutability`, `test:parity` all still pass
- `typecheck` clean
