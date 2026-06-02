# Phase 11 — Eval-Case Expansion (PLAN + DONE)

> GSD plan→execute→verify. Agents-session scope. Closes AGENTS-PLAN P2 #9 ("expand eval cases
> beyond the 12 critical ones, esp. chain participants + high-volume monitors, so promotion is
> evidence-driven"). DATA only (eval cases are data); no app code.

## Gap
13 cases / 11 agents. **Only 8 of 14 can't-fail agents had any eval coverage**, and the high-volume
monitors + chain participants had none — so `agent-evaluator`/`proposeAutonomyChange` had nothing to
score them on.

## Done
- **Completed can't-fail coverage:** added critical cases for the 7 missing — `access-auditor`,
  `contract-lifecycle-manager`, `decision-memo-drafter`, `offer-architect`, `reinvestment-advisor`,
  `risk-register-keeper`, `cliently.dev`. Every can't-fail agent now carries ≥1 critical case.
- **High-volume monitors:** `connector-health-monitor`, `pixel-watcher`, `funnel-monitor`,
  `rate-limit-guardian`, `cash-position-monitor`.
- **Chain participants (E.1/E.2/E.4):** `lead-triage`, `booking-concierge`, `onboarding-runner`
  (payment-gate refusal), `billing-runner`.
- Result: **29 cases / 27 agents** (was 13/11). Each case is a concrete scenario + a precise
  behavioral assertion in the existing style (propose-not-execute, refuse-bypass, ground-in-data).
- `_evals.test.ts` (15 cases): schema-valid, no dupes, known kinds, coverage breadth, and the
  invariant **every can't-fail agent has a critical case**. Wired into `test-all.sh`.

## Verify
Agent-scope sweep green incl. `_evals` 15/15; seed-evals validator + missing-agent guard unchanged
(all referenced keys confirmed seeded).

## Follow-ups (not done)
- Optional go-live gate: assert in `verify-golive` that every can't-fail agent has an eval row in the
  DB (the manifest test already enforces it at author time; DB-side is belt-and-suspenders).
- Expand to remaining chain links + reasoning workhorses as run data accrues.
