---
phase: 11-external-runtime-optimization
reviewed: 2026-06-03T00:00:00Z
depth: standard
mode: re-review-after-patches
files_reviewed: 4
files_reviewed_list:
  - .planning/phases/11-external-runtime-optimization/11-CONTEXT.md
  - .planning/phases/11-external-runtime-optimization/11-01-PLAN.md
  - .planning/phases/11-external-runtime-optimization/11-02-PLAN.md
  - .planning/phases/11-external-runtime-optimization/11-03-PLAN.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
recommendation: READY for /gsd:execute-phase 11
prior_review_commit: f5186bb
prior_findings_resolved: 13
---

# Phase 11 Code Review — Delta Re-review (post-patch verification)

## Summary

Re-reviewed the 4 PLAN files after commit `f5186bb` ("patch all 13 code-review findings") applied
patches against the 13 findings from the prior review. **All 13 findings are RESOLVED.** No new
BLOCKER or WARNING-level defects were introduced by the patches. Phase 11 plans are READY for
execution.

The patches are surgical and consistent with the scope-fence: all edits land in `.planning/phases/`
(PLAN.md / CONTEXT.md text) and do not touch the live-fleet (`scripts/seed/`,
`external/acqu-skills/`, `CLAUDE.md`, the three top-level plans, `tier-models.ts`, `hydrate.ts`).

---

## Patch Verification (13/13)

### Critical

**CR-01 — RESOLVED** ✓
`11-01-PLAN.md:331` (post-commit) + `:226-237` (pre-commit) — Both gates now use
`git diff HEAD~1 --name-only` / `git diff HEAD --name-only` (no `--diff-filter=M`), pipe to
`wc -l`, and exit 1 with `if [ "$modified" -ne 0 ]` / `if [ "$modified_pre" -ne 0 ]`. A/M/D/R
modifications are all caught. The CR-01 callout in the `<done>` block names the regression
("catches A/M/D/R").

**CR-02 — RESOLVED** ✓
`11-02-PLAN.md:300-323` — Shingle-based detector iterating all 8 candidate↔source pairs.
Normalizes whitespace + case via `tr -s '[:space:]' '\n' | tr '[:upper:]' '[:lower:]'`. Emits
sliding 8-word shingles via awk; computes shared shingles with `comm -12 <(... | sort -u) <(... |
sort -u)`; threshold `> 10` triggers `exit 1`. Source-existence guard included. The 8-pair loop
covers every candidate.

### Warnings

**WR-01 — RESOLVED** ✓
`11-02-PLAN.md:488-492` — Uses `git for-each-ref --contains="$branch_tip" --format='%(refname)'`
piped through `grep -vE '^refs/(heads|remotes/origin)/feat/external-skills-extraction$'`.
Excludes the branch's own local + origin refs; flags reachability from anywhere else (main,
release, or any branch that merged the extraction work) with `exit 1`.

**WR-02 — RESOLVED** ✓
`11-03-PLAN.md:168-182` — DECISIONS template now carries a "Pre-existing drift to resolve before
Phase 13" section. Names `cliently.dev`, references both `CLAUDE.md` and
`packages/core/src/architect/hydrate.ts` `CANT_FAIL_KEYS`, and presents both reconciling decisions
(drop from doctrine vs. add to code). The verify block at `11-03-PLAN.md:214-217` asserts both the
section heading and `cliently.dev` presence with `exit 1` on miss.

**WR-03 — RESOLVED** ✓
`11-01-PLAN.md:133` — Replaced the always-true grep chain with
`git diff HEAD -- packages/core/src/router/tier-models.ts | wc -l | awk`, which exits 1 if any
line of diff exists for the protected file.

**WR-04 — RESOLVED** ✓
`11-02-PLAN.md:324-333` — Anchored `^(...)$` allowlist regex enumerating all 28 EVENT_NAMES
(verified count: 4+2+2+3+2+1+2+1+2+2+3+2+1+1 = 28). Three-segment `connector.health.degraded` /
`recovered` is encoded as `connector\.health\.(degraded|recovered)` in the allowlist AND in the
discovery prefix (`connector\.health` listed alongside the other prefixes), so the discovery grep
captures the full 3-segment form before the allowlist check. Any non-allowlisted event triggers
`exit 1`.

**WR-05 — RESOLVED** ✓
`11-CONTEXT.md:168` — Scope-fence section now carries the "WR-05 enforceability note" explaining
that operator gates 1-3 (`supabase db push`, `pnpm seed:phase-9`, `pnpm verify:isolation-live`)
are enforced **by construction**, not by automated verify gate. The note cites three independent
reasons (no PLAN shell-injects them, sandbox lacks Supabase service-role credentials,
`verify:isolation-live` hard-fails on missing `RLS_TEST_DATABASE_URL`). Future plan revisions are
explicitly told to add a verify gate if a shell-out path is introduced.

**WR-06 — RESOLVED** ✓
`11-03-PLAN.md:198-199` — Downstream phases section now lists two Phase 12 checkbox items:
(i) `agents.key` immutability regression test through bundle hydration, and (ii)
`T_CRITICAL_ALLOWLIST` ↔ `T_CRITICAL_MODEL_ALLOWLIST` parity regression test. Both are properly
attributed to WR-06 and explain the forward-looking risk they close.

**WR-07 — RESOLVED** ✓
`11-02-PLAN.md:292-297` — Asserts exactly 1 line of `^bound_to:` via `grep -cE '^bound_to:'` with
`-ne 1` exit 1; then asserts the value via `grep -qE '^bound_to:[[:space:]]+NONE\b'`. Whitespace-
tolerant. Catches both multi-line duplicate-binding attacks and typo/case variants.

### Info

**IN-01 — RESOLVED** ✓
`11-01-PLAN.md:132` — Word-count gate tightened to `[1600, 2100]` from `[1400, 2200]`. Uses awk
`exit 1` on out-of-range. The lower bound now meaningfully surfaces under-developed sections.

**IN-02 — RESOLVED** ✓
`11-01-PLAN.md` action block at `11-02-PLAN.md:188-212` documents per-candidate encoding: 5
single-source candidates use `source_path:`; 3 dual-source candidates
(`prompt-injection-guardrail`, `output-quality-gate`, `secret-scan-veto`) use the `source_paths:`
list form. Verify at `11-02-PLAN.md:298-299` accepts either via `grep -qE "^source_path(s)?:"`.

**IN-03 — RESOLVED** ✓
`11-03-PLAN.md:211-213` — Counts table rows via `grep -cE '^\|.*KEEP-FOR-LATER'`, asserts exactly
8. Confirmed by row count: each of the 8 candidate rows contains `<KEEP-FOR-LATER \| ... \| ...>`
in the operator-decision column, exactly one matching line per row regardless of whether the
"Recommended" column also contains a KEEP-FOR-LATER phrase.

**IN-04 — RESOLVED** ✓
`11-01-PLAN.md:242-246, 332` — Both the pre-commit probe and the post-commit verify use
`if touch /tmp/ref/.write_probe 2>/dev/null; then ... exit 1; fi`. Write-attempt probe is the
actual non-writability assertion (not the always-succeeds `chmod a-w` check).

---

## New defects introduced by patches

**None at BLOCKER or WARNING severity.**

Two observations that do NOT meet the bar for a finding (kept as cross-cutting notes for the
operator's awareness):

- The CR-02 shingle detector compares each candidate against its **primary** source only.
  Three candidates have a documented secondary source (the IN-02 dual-source set:
  `prompt-injection-guardrail` → `SELF_IMPROVEMENT_AND_GATES_SPEC.md` §B3,
  `output-quality-gate` → §B1, `secret-scan-veto` → `gate-never-inject-client-keys/SKILL.md`).
  Verbatim lifts from a secondary source would be missed. This is a known coverage gap, not a
  regression — the prior review flagged only the primary-source case, and the patch covers
  exactly what was asked. Not a blocker; can be tightened later if any secondary-source lift is
  ever observed.

- The WR-04 discovery grep uses `\b` word boundaries with `[a-z_]+`. An event-shaped token
  embedded inside a longer identifier (e.g. `tool.result_handler` in prose) would be greedily
  captured as `tool.result_handler`, fail the allowlist, and `exit 1`. This is the correct
  fail-closed behavior, but it means prose that incidentally writes a quasi-event token will
  trip the gate. Acceptable defensive posture for a closed-namespace check.

---

## Cross-cutting confirmations (re-verified)

- **Live-fleet protection**: All 13 patches landed in `.planning/` files only. Re-scanned the 4
  plan files for any reference to writing to `scripts/seed/`, `external/acqu-skills/`,
  `CLAUDE.md`, `tier-models.ts`, or `hydrate.ts` — none introduced.
- **T-critical exclusion**: `bound_to: NONE` enforcement is now structurally sound (WR-07 fix).
- **Scope-fence enforceability**: WR-05 note converts an aspirational refusal into a documented
  by-construction guarantee. Operators are told what would break that guarantee.
- **Operator decision capture**: WR-02 + WR-06 fixes make the 11-03 DECISIONS template the
  canonical handoff point to Phase 12 / Phase 13.

---

## Recommendation

**READY for `/gsd:execute-phase 11`.**

All 13 prior findings are resolved. The verify gates now match the strength of the `<done>`
blocks they protect. No new defects of BLOCKER or WARNING severity were introduced by the
patches.

Execution-time reminders for the runtime agent (not findings — operator-facing notes):
1. Task 3 of 11-01 uses `git diff HEAD~1` post-commit; the commit step must complete before that
   verify runs (sequential ordering in the task block, already enforced).
2. The WR-01 `git for-each-ref --contains` check at 11-02 Task 4 runs **after** the push
   completes. If a future runner re-orders these steps, the check could pass before the branch
   tip lands at origin; current ordering is correct.
3. The CR-02 shingle check sources `/tmp/ref/.../hermes-runtime/skills/agentic/<src_slug>/SKILL.md`
   — the chmod a-w invariant from IN-04 must hold throughout Task 2 of 11-02 (it does — Task 2
   only reads).

---

_Reviewed: 2026-06-03T00:00:00Z_
_Reviewer: gsd-code-reviewer (standard depth, delta re-review mode)_
_Prior review: 13 findings → 13 resolved → status clean_
