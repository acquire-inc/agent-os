---
phase: 11-external-runtime-optimization
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - .planning/phases/11-external-runtime-optimization/11-CONTEXT.md
  - .planning/phases/11-external-runtime-optimization/11-01-PLAN.md
  - .planning/phases/11-external-runtime-optimization/11-02-PLAN.md
  - .planning/phases/11-external-runtime-optimization/11-03-PLAN.md
  - packages/core/src/router/tier-models.ts
  - packages/core/src/router/resolve.ts
  - packages/core/src/seed/seedAgent.ts
  - apps/runner/src/execute.ts
findings:
  critical: 2
  warning: 7
  info: 4
  total: 13
status: issues_found
---

# Phase 11 Code Review — Findings

## Summary

Phase 11 is a doc + quarantined-branch phase with strong scope discipline. The runtime safety assertion in `assertCantFailModel` is sound for Path B propagation (verified — non-T-critical agents bypass the check; only T-critical agents on non-Opus models fail closed). However, several verify gates are weaker than the `<done>` blocks they protect, and there is a genuine doctrine-vs-code drift around `cliently.dev` that the Wave 2 plan steps on. Two BLOCKER-severity scope-fence-enforceability gaps would let `execute-phase` pass with the fence breached.

---

## Critical (BLOCKER)

### CR-01: 11-01 Task 3 live-fleet-modification verify gate is structurally broken — will pass when scope-fence is breached

**File:** `.planning/phases/11-external-runtime-optimization/11-01-PLAN.md:224, 311`

**Issue:** The gate that enforces "zero live-fleet changes" (the central scope-fence claim) has two defects:

1. Line 224 uses `git diff --stat HEAD --diff-filter=M ...` — `--diff-filter=M` excludes ADDITIONS (`A`) and DELETIONS (`D`). An agent that ADDS a file under `scripts/seed/` would NOT be caught. Same for deletions.
2. The line-224 pipe `git diff --stat HEAD --diff-filter=M ... | wc -l` doesn't match the awk's expectation of "EMPTY" — `git diff --stat` returns a summary line even when the filter excludes everything.

**Fix:** Use `--name-only` (no summary footer) and drop `--diff-filter` to catch A/M/D/R alike:
```bash
modified=$(git diff HEAD~1 --name-only -- scripts/seed/ external/acqu-skills/ CLAUDE.md \
  docs/plans/AGENT-OS-PLAN.md docs/plans/AGENTS-PLAN.md docs/plans/GENX-PLAN.md \
  docs/plans/OPTIMIZATION-AUDIT.md packages/core/src/router/tier-models.ts \
  packages/core/src/architect/hydrate.ts | wc -l)
if [ "$modified" -ne 0 ]; then echo "FAIL: $modified live-fleet files modified"; exit 1; fi
echo "OK: zero live-fleet changes"
```

### CR-02: 11-02 Task 2 verbatim-line copy-paste check is structurally inverted — silently passes any copy-paste

**File:** `.planning/phases/11-external-runtime-optimization/11-02-PLAN.md:279-283`

**Issue:** Two defects in the copy-paste detector:

1. `grep -F -x -f` requires EXACT FULL-LINE matches. A copy-paster who reformats indentation defeats this entirely. The threshold "≤3 incidental matches" trivially passes because true verbatim full-line matches are rare even when 95% of text is lifted.
2. The filter pattern `^- |^[0-9]\.|^\*\*|^---` strips out exactly the high-signal lines (list items, numbered steps, bold markers, frontmatter). Doctrine SKILL.md content is mostly those. Filtering before counting is exactly backwards. Plus: the check only runs against 1 source path (verification-before-completion-v2). The other 7 candidates have NO copy-paste check.

The `<done>` block claims "no detectable copy-paste; Relay events from closed namespace only" — but this check cannot detect copy-paste.

**Fix:** Fuzzy/shingle check across all 8 pairs. (See full fix block in the agent's report — uses normalized 8-word shingles + `comm -12` against both files; fails when ≥10 shared shingles.)

---

## Warnings

### WR-01: Scope-fence "REFUSE to merge feat/external-skills-extraction" has no automated verify for other branches

**File:** `11-CONTEXT.md:165`, `11-02-PLAN.md:443-444`

The scope-fence says merging into "any other branch" is refused. 11-02 Task 4 only checks `claude/exciting-davinci-yvptm`. An agent that ran `git checkout main && git merge feat/external-skills-extraction` would pass.

**Fix:** Assert the branch's HEAD is unreachable from any other ref:
```bash
branch_tip=$(git rev-parse feat/external-skills-extraction)
reachable_from=$(git for-each-ref --contains="$branch_tip" --format='%(refname)' | \
  grep -vE '^refs/(heads|remotes/origin)/feat/external-skills-extraction$' | head -1)
if [ -n "$reachable_from" ]; then echo "FAIL: branch reachable from $reachable_from"; exit 1; fi
```

### WR-02: Doctrine-vs-code drift — `cliently.dev` is can't-fail per CLAUDE.md but NOT in code-level CANT_FAIL_KEYS

**File:** `11-02-PLAN.md:67, 109, 268, 313, 392`

**Issue:** CLAUDE.md (project doctrine) explicitly lists `cliently.dev` (code-writing) as can't-fail. The actual `CANT_FAIL_KEYS` Set in `packages/core/src/architect/hydrate.ts` does **NOT** include `cliently.dev`. 11-02-PLAN.md takes the code position and proposes attaching `secret-scan-veto` to `cliently.dev` as "advisory", framing this as compliant with the T-critical exclusion rule.

- If doctrine wins: attaching is a T-critical violation (scope-fence breach)
- If code wins: doctrine is wrong and CLAUDE.md needs updating

This phase refuses to modify CLAUDE.md or hydrate.ts, so neither side reconciles here. **Surface in 11-03-DECISIONS.md** as a pre-Phase-13 blocker.

**Fix:** Add a new section to the 11-03-DECISIONS.md template:
```markdown
## Pre-existing drift to resolve before Phase 13
- CLAUDE.md lists `cliently.dev` as can't-fail; CANT_FAIL_KEYS in hydrate.ts does NOT.
- Decision: <update CLAUDE.md to drop cliently.dev | update CANT_FAIL_KEYS to add it | other>
- Blocker for: secret-scan-veto attachment in Phase 13
```

### WR-03: 11-01 Task 1 verify gate for "tier-models.ts NOT modified" is structurally always-true

**File:** `11-01-PLAN.md:133`

Current check evaluates `((! grep) || grep) && echo` — left-to-right associativity makes it `1 && echo`, always true. Never fails the gate even if the file was modified.

**Fix:** Use `git diff`:
```bash
git diff HEAD -- packages/core/src/router/tier-models.ts | wc -l | \
  awk '{ if ($1 != "0") { print "FAIL: tier-models.ts modified"; exit 1; } else print "OK" }'
```

### WR-04: 11-02 Task 2 Relay-event closed-namespace check has false-positive coverage AND silent "WARN" non-failure

**File:** `11-02-PLAN.md:285-288`

Three defects:
1. Regex `(emit|fires?) [a-z]+\.[a-z_]+` only matches `emit foo.bar` / `fires foo.bar` literal forms — natural prose like "emits a finding.recorded event" is missed.
2. `connector.health.degraded` (3 segments) doesn't match the alternation pattern correctly — it triggers a false-positive WARN.
3. The check writes `WARN:` and does NOT `exit 1`. The `<done>` block claims enforcement but the check cannot fail the gate.

**Fix:** Use the canonical `EVENT_NAMES` list as an allowlist directly with proper regex anchoring + `exit 1` on failure.

### WR-05: Scope-fence refusal "Run operator gates 1-3" has no verify gate

**File:** `11-CONTEXT.md:167`

The fence refuses `supabase db push`, `pnpm seed:phase-9`, `pnpm verify:isolation-live`. No verify in any plan asserts these were not run. The refusal is aspirational, not enforced.

**Fix:** Either add an explicit gate (check for fresh migration mtimes, snapshot DB state) or document in the scope-fence that operator gates 1-3 are "shell-injected only — no autonomous run path exists, so enforcement is by-construction not by-assertion."

### WR-06: `assertCantFailModel` Path B safety is sound today, but no regression test enforces it

**File:** `apps/runner/src/execute.ts:60-92`

**Status:** Path B propagation (demoting Hermes-4-* in `DEFAULT_TIER_MODELS`) does NOT affect this path — confirmed safe. Non-T-critical agents bypass the check; only T-critical agents on non-Opus models fail closed.

**Forward-looking concern:** A future phase that changes the runner to honor in-flight tier-overrides could bypass `seedAgent`. The assertion still catches Opus-violation for T-critical agents since `isCantFail(b.agent.key)` reads the stable key. No regression test enforces `b.agent.key` immutability through bundle hydration.

**Fix:** Add to 11-03-DECISIONS.md "downstream phases" section a checkbox: "Phase 12 must add a regression test for `agents.key` immutability through bundle hydration."

### WR-07: 11-02 Task 2 verify for `bound_to: NONE` doesn't catch typos or multiple-binding variants

**File:** `11-02-PLAN.md:277`

`grep -q "bound_to: NONE"` matches one line. An author who writes `bound_to: NONE` AND `bound_to: secrets-rotation` (a second line ADDED below) passes the grep. Whitespace/case variants also bypass.

**Fix:**
```bash
for s in agents/_candidates/*/SKILL.md; do
  count=$(grep -cE '^bound_to:' "$s")
  if [ "$count" -ne 1 ]; then echo "FAIL: $s has $count bound_to: lines"; exit 1; fi
  grep -qE '^bound_to:[[:space:]]+NONE\b' "$s" || { echo "FAIL: $s bound_to not NONE"; exit 1; }
done
```

---

## Info

### IN-01: 11-01 Task 1 word-count gate `[1400, 2200]` is wide

A 1400-word output likely cut a required section. Tighten to `[1600, 2100]` to surface under-development before commit.

### IN-02: Several candidates have dual-source structure but the Provenance schema only carries one `source_path`

`output-quality-gate` (voice-and-brand + B1), `prompt-injection-guardrail` (gate-platform-access-ladder + B3), `secret-scan-veto` (gate-security-auditor-veto + gate-never-inject-client-keys). The template needs `source_paths:` (list) OR explicit documentation that secondary refs go in `reauthor_notes`.

### IN-03: 11-03-PLAN Task 2 KEEP-FOR-LATER count gate counts string occurrences, not table rows

`grep -c "KEEP-FOR-LATER"` triggers on placeholder text AND "Recommended" column entries. Expected count is ~12, not 8. **Fix:** `grep -c "^|.*KEEP-FOR-LATER"` to bind to table rows.

### IN-04: 11-01 Task 3 chmod-a-w check is a non-assertion

`chmod a-w` on a tree you own succeeds silently — no "permission denied" emitted. The check passes regardless of /tmp/ref state.

**Fix:** Use a write-attempt probe:
```bash
touch /tmp/ref/.write_probe 2>&1 >/dev/null
if [ -f /tmp/ref/.write_probe ]; then rm /tmp/ref/.write_probe; echo "FAIL: writable"; exit 1; fi
echo "OK: read-only"
```

---

## Cross-Cutting Observations (not findings)

- **Source-path mapping confirmed:** All 8 candidate source paths exist under `/tmp/ref/.../hermes-runtime/skills/agentic/`. Mapping is sound.
- **Relay namespace mapping confirmed:** All events cited in the PLANs are in `EVENT_NAMES` at `packages/core/src/relay/events.ts`. Closed-namespace constraint is satisfiable; the verify just needs hardening (WR-04).
- **`assertCantFailModel` Path B safety confirmed:** Lines 60-62 short-circuit on `!isCantFail(b.agent.key)`. Path B propagation is safe through this assertion.
- **`tier-models.ts` T-critical pin parity:** `T_CRITICAL_ALLOWLIST` (router) and `T_CRITICAL_MODEL_ALLOWLIST` (runner) are duplicated string literals. Worth a regression test in Phase 12 to enforce parity.

---

## Recommendation

**Do NOT run `/gsd:execute-phase 11` until CR-01 + CR-02 are patched** in the PLAN.md files. The BLOCKERs are structural verify-gate defects — `execute-phase` would self-verify "OK" while the scope-fence is actually breached, defeating the central guarantee of this phase.

**Recommended fix path** (5 small patches, no execute-phase run needed):
1. **CR-01** — patch `11-01-PLAN.md` Task 3's `git diff` invocation (1 verify gate)
2. **CR-02** — patch `11-02-PLAN.md` Task 2's copy-paste check (1 verify gate; shingle-based)
3. **WR-02** — add the cliently.dev drift section to `11-03-PLAN.md`'s DECISIONS template
4. **WR-03** — patch `11-01-PLAN.md` Task 1's tier-models.ts unchanged-check (1 verify gate)
5. **WR-04** — patch `11-02-PLAN.md` Task 2's Relay event check (`exit 1` on violation; use EVENT_NAMES allowlist)

These are PLAN.md edits only (no live-fleet changes; consistent with Phase 11's scope-fence). After patching, the plan can be re-reviewed (`/gsd:code-review 11`) and then executed (`/gsd:execute-phase 11`).

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: gsd-code-reviewer (standard depth, 8 files)_
