# Platform Readiness — AgentOS Control Plane

> Principal-engineer assessment of what stands between the current control-plane
> and a launchable multi-tenant agent platform. Written 2026-06-10.

## Thesis

AgentOS sells the same thing Viktor does, generalized: **agents that plug into
your tools, act autonomously, and stay under operator control.** The product is
three pillars, and a launch needs all three to feel true:

1. **Visibility** — see everything your agents are doing, across every connected
   tool, in real time. (Viktor's "active access to everything.")
2. **Control** — change agent behavior without a deploy: autonomy, budget,
   which tools it can touch, approval policy.
3. **Trust** — audit trail, approval gates, cost caps, tenant isolation. An
   operator hands an autonomous agent the keys only if it can't go off the rails.

## Current state (honest)

| Pillar | State |
|---|---|
| Visibility | **Weakest.** Runs board + per-run detail exist, but the tool-call stream (`RunActivity`: which connector, what action) is buried one run at a time. No fleet-wide "what is everything doing" view. |
| Control | **Read-only.** Agent config (model/autonomy/budget/connectors) renders as static fields. You can't actually change an agent from the UI yet. |
| Trust | **Best-developed.** Approvals inbox, `model.routed` audit, budget caps/projection, cost dashboards all shipped. Tenant isolation (RLS) is real in schema; live verification is Phase 9 (operator-blocked on DB). |
| Analytics | Shipped: tabbed Dashboard (agent perf / fleet / cost / model routing). |
| Connectors | Shipped: 70-connector catalog + add-your-own, working in demo via a localStorage store. The binding *agent ↔ connector* is shown but not editable. |

## Launch-blocking gaps, prioritized

1. **Fleet Activity / Command Center** — the missing hero. A live, fleet-wide
   timeline of agent actions across connectors (tool calls, proposals,
   summaries, status). This is the demo that sells the platform and the
   strongest pillar-1 lever. *(executing now)*
2. **Editable agent control surface** — autonomy slider, budget cap, connector
   bindings, approval policy, enable/disable — persisted (client store in demo,
   API in prod). Turns the app from a viewer into a control plane.
3. **Onboarding / first-run** — zero-to-value: pick a template agent → connect a
   tool → watch it run. Required for self-serve tenants.
4. **Connector OAuth realism** — a real connect flow (even mocked) per auth type;
   per-connector scopes/permissions surfaced (the trust story for "active access").
5. **Backend reality** — Phase 9 isolation + live data + real run/relay ingest.
   Operator-gated (DB access); tracked in ROADMAP.md.

## Architecture notes for launch

- **Keep the demo-store pattern** (`connector-store.ts`): a localStorage overlay
  that mirrors the eventual API shape means every interactive feature works in
  the demo and swaps to Supabase with no UI change. Apply the same pattern to
  editable agent config and activity.
- **Derive demo analytics from one synth source** (`data.agentPerformance`) so
  views never contradict each other — a real bug class we already hit and fixed.
- **The connector layer is the moat.** Invest there: bindings, scopes, health,
  per-tool audit. That's what "active access to everything" actually means.

## Decision

Build **#1, the Fleet Activity Command Center**, now. It is the highest-leverage
pillar-1 work, fully buildable on existing data, and the screen that makes this
read as a platform rather than an admin panel. #2 (editable control surface) is
the natural next execution.
