# Phase 14 — Go-Live Readiness Capstone (PLAN + DONE)

> GSD capstone: define "agents finalized," prove it with one aggregate gate, document honestly.

## Done
- `readiness.test.ts` — aggregate go-live gate over the real manifests (no DB): enumerates the full
  93-agent fleet (dedicated ∪ roster ∪ doctrine) and asserts the go-live invariants:
  1. every can't-fail agent is seeded (no dangling key)
  2. every can't-fail agent has a critical eval case
  3. every can't-fail agent is ceiling=propose
  4. no orphan eval case (every case → a seeded agent)
  5. every referenced skill resolves to a SKILL.md
  6. every skill declares allowed-tools (103/103)
  7. no catalogued tool is irreversible-but-ungated
  8. both universal safety skills are canonical
  → **PASS 9/9.** Wired into test-all.sh.
- `docs/plans/GO-LIVE-READINESS.md` — per-pillar readiness with evidence + the honest list of what
  still gates ACTUAL cutover (platform P0s: Relay spine, RLS audit, Inngest, runtime tool-map;
  operator: Hermes fork; per-tenant OAuth). Agent DATA = finalized.

## Outcome
Agent DATA is finalized and go-live ready (the gate proves it). Actual system cutover remains gated
on platform-owned P0s + the operator model decision — explicitly out of the agents-session lane.
