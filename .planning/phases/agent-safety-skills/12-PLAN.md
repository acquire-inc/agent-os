# Phase 12 — Primary-Skill Anatomy + Guardrails (PLAN + DONE)

> GSD plan→execute→verify. Agents-session scope. DATA only (skills are data).

## Gap
A skill is how an agent does its core job. 12 primary/bound skills had real step content but were
in **thin form**: no `## Steps`/`## Guardrails` structure and — the real gap — **no Guardrails
section at all**, so an agent doing creative generation, client onboarding, churn outreach, etc.
got the "how" with **no explicit safety rails** (propose-not-execute, gate-respect, never-auto-send).

## Done
- `author-skill-anatomy.ts` (idempotent, `--check` gate): brought all 12 to canonical anatomy —
  inserted `## Steps`, appended a function-specific `## Guardrails` section grounded in doctrine
  non-negotiables. Frontmatter (incl. allowed-tools from 09-03) and existing steps untouched.
  Skills: creative-generation, lead-routing-qualification, client-onboarding, churn-risk-detection,
  weekly-client-reporting, client-health-scan, memory-consolidation, competitor-ad-teardown,
  content-engine, proposal-drafting, meeting-prep, playbook-capture.
- Guardrails encode real gates: client-onboarding → `first_payment.received` (E.1); creative/
  competitor → `ad-claim-compliance` before launch (Gate 1); proposal → pricing human sign-off;
  churn/reporting/content → propose-not-auto-send; memory/playbook → large outputs to files
  (non-negotiable #4).
- `_skill-anatomy.test.ts` (64): every targeted skill has `## Steps` + `## Guardrails` + ≥1 bullet,
  allowed-tools + steps preserved, and the doctrine anchors landed. `--check` wired into test-all.sh.

## Verify
Agent-scope sweep green incl. `_skill-anatomy` 64/64; allowed-tools coverage still 103/103.

## Follow-up
The 12 thinnest are done; the remaining skills already have ≥10-line bodies. A fleet-wide Guardrails
pass (all 103) is a larger optional follow-up.
