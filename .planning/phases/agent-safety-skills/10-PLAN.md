# Phase 10 — Agent Safety-Skill Hardening (PLAN)

> GSD plan-phase. Scope: **agents only** (this is the Agents code session). Extracted from
> `docs/plans/AGENTS-PLAN.md` (canonical anatomy §1, Relay emission §2, improvement plan §3) and the
> external "OUTPUT 2" task list — keeping **only what is real, agent-scope, and not blocked**.

## What the source asked for vs. what's actually actionable here

| OUTPUT 2 / AGENTS-PLAN item | Reality in this repo | Verdict |
|---|---|---|
| Author the two "missing" safety SKILL.md (verification-before-completion, clarify-before-acting) | Both exist. `verification-before-completion` is a solid canonical skill (92 agents). `clarify-before-acting` is **thin** — 6 lines, no Steps/Guardrails (42 agents). | **DO:** deepen `clarify-before-acting` to canonical anatomy; light-touch `verification` to tie its outcome to the run-summary `verification_result`. |
| `run_summaries` + SessionEnd hook (P0 #1) | **Built** — `lifecycle.ts:58` writes on completion; `recentRunSummaries` reads. | Reconcile AGENTS-PLAN (mark done). |
| Run-summary continuity into the bundle (P0 #3) | **Built** — `bundle.ts:173` → `recentSummaries`; tested this session. | Reconcile AGENTS-PLAN (mark done). |
| allowed-tools on more SKILL.md (P2 #8) | **Done this session** — all 103 (Phase 9, 09-03). | Reconcile AGENTS-PLAN (mark done). |
| Per-agent Relay emission contract (§2) | Relay **spine + schema owned by `AGENT-OS-PLAN.md`, which does not exist**. Emission is runtime/hooks, not per-agent prompt. | **Gap-list (platform-blocked).** Not faked. |
| ad-ops tool literals → registry keys | ad-ops already uses registry keys (`tool.1`=Meta Adapter). Real gap = `tool_key→runtime` map (P1 #7). | Already correct; mapping deferred (platform). |
| offer-architect/validator: author or de-list from can't-fail | Already seeded (`_roster.ts:67-68`) **and** in `CANT_FAIL_AGENTS`. | Already resolved. |
| can't-fail → Opus floor | Contradicts shipped operator override (all-Hermes-405B + autonomy ceiling). | Operator-gated; untouched. |

## Plans

### 10-01 — Deepen `clarify-before-acting` to canonical anatomy
- Rewrite to match the quality/shape of `verification-before-completion`: frontmatter (keep
  `allowed-tools`), **## When to load**, **## Steps** (name the fork → 2-4 concrete options incl.
  "do nothing" → one multiple-choice Approval via `tool.17` → suspend → act-as-chosen),
  **## Guardrails**. Tie to the autonomy gate / Approvals inbox (§1.6) and the proposed-vs-done
  distinction. **Behavior-preserving** (same intent: clarify before irreversible) — richer, not new.
- ⚠ **FLAG:** this skill is bound to T-critical agents (it's the conditional safety skill). Change
  is an *improvement* to a safety playbook — no model/skill-set change to any agent. Surfaced for
  operator awareness per the "don't silently alter T-critical" rule.

### 10-02 — Light-touch `verification-before-completion`
- Add the one missing link: its outcome **is** the run-summary `verification_result` field
  (AGENTS-PLAN §1.3 step 5 + §2.2). Single line + a step note; no restructure.

### 10-03 — Structural test for both safety skills (pure, no DB)
- `_safety-skills.test.ts`: each has frontmatter (name/description/allowed-tools), a `## Steps` and
  `## Guardrails` section, ≥4 steps, and the domain anchors (clarify → approval + "do nothing";
  verification → `verification_result`). Wired into `test-all.sh`.

### 10-04 — Reconcile `AGENTS-PLAN.md` to current reality
- Dated addendum: P0 #1 (`run_summaries`+SessionEnd) + #3 (continuity) **built**; P2 #8
  (allowed-tools) **done**; Phase 9 tool-metadata/connector enrichment noted. Relay spine / RLS
  audit / Inngest / `tool_key→runtime` map remain **platform-blocked (AgentOS session)** — explicitly
  not this session's lane.

## Out of scope (gap-listed, not done)
- Relay event spine/emitter/registry, fleet-wide RLS audit, Inngest chain execution,
  `tool_key→runtime` SDK map, eval-case expansion (P2 #9) — platform-owned or larger follow-ups.

## Verify
GSD code-review on the diff (the `code-review` skill) → address findings → pure-test sweep green.
