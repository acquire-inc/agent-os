// scripts/seed/_chains.ts
// The v2 Part E handoff chains, as DATA. Each chain is an ordered list of steps; a step
// names the agent, the inbound event that triggers it (`on`), and the event it emits
// (`emits`, documentation — emission is behavioral, in the agent's prompt/actions).
//
// Wiring = the subscriber side: for every step with `on`, the agent gets a typed trigger
// (state/webhook) on that event key. That's exactly what the event executor (Inngest)
// reads to route an event to the agents that handle it. Canonical event vocabulary below
// keeps emitters and subscribers speaking the same language across functions.

export type Via = "state" | "webhook";
export type ChainStep = { agent: string; on?: string; via?: Via; emits?: string; note?: string };
export type Chain = { id: string; name: string; owner: string; steps: ChainStep[] };

export const CHAINS: Chain[] = [
  {
    id: "E.1",
    name: "Acquisition → Cash (the spine)",
    owner: "briefing owns chain-health (stall detection)",
    steps: [
      { agent: "lead-triage", on: "application.submitted", via: "webhook", emits: "lead.qualified" },
      { agent: "booking-concierge", on: "lead.qualified", emits: "call.booked" },
      { agent: "discovery-prep", on: "call.booked", emits: "discovery.brief.ready" },
      { agent: "call-summarizer", on: "call.completed", emits: "deal.verbal_yes" },
      { agent: "discount-governor", on: "discount.requested", emits: "discount.resolved" },
      { agent: "contract-drafter", on: "deal.verbal_yes", emits: "contract.signed" },
      { agent: "payment-collector", on: "contract.signed", emits: "first_payment.received", note: "HARD GATE: onboarding cannot start before this" },
      { agent: "onboarding-runner", on: "first_payment.received", emits: "client.activated" },
      { agent: "billing-runner", on: "client.activated", emits: "billing.started" },
      { agent: "win-detector", on: "client.activated", note: "starts watching for proof moments" },
      { agent: "client-health", on: "client.activated", note: "starts scoring" },
      // dunning-manager already subscribes to payment.failed (seeded); revenue-recognizer/
      // unit-economics/cash reads are nightly cron (E.7), not event-driven.
    ],
  },
  {
    id: "E.2",
    name: "Creative → Launch (with the compliance gate)",
    owner: "Fulfillment PM; D6.1 owns the gate",
    steps: [
      { agent: "creative-studio", on: "brief.approved", emits: "creative.package.ready" },
      { agent: "creative-critic", on: "creative.package.ready", emits: "creative.critique.passed" },
      { agent: "ad-claim-compliance", on: "creative.package.approved", emits: "compliance.passed", note: "PRE-LAUNCH GATE — FLAG blocks launch" },
      { agent: "launcher", on: "compliance.passed", emits: "ad.launched.paused" },
      { agent: "ad-ops", on: "ad.launched.paused", note: "daily optimization once live" },
      { agent: "pixel-watcher", emits: "pixel.broken", note: "watches tracking; halts ad-ops on break" },
    ],
  },
  {
    id: "E.3",
    name: "Channel → Commission",
    owner: "Partnerships",
    steps: [
      { agent: "partner-enablement", on: "partner.active", emits: "referral.link.issued" },
      { agent: "referral-tracker", on: "referred.deal.won", emits: "commission.accrued", note: "fraud-checks before accrual clears" },
      { agent: "commission-processor", on: "commission.accrued", emits: "commission.payout.batched" },
      { agent: "bill-pay", on: "commission.payout.approved", note: "pays the partner" },
    ],
  },
  {
    id: "E.4",
    name: "Churn-signal chains (many sources → one destination)",
    owner: "Retention",
    steps: [
      // Many upstream sources, all routed to churn-risk-detector.
      { agent: "churn-risk-detector", on: "client.health.dropped" },
      { agent: "churn-risk-detector", on: "performance.missed" },
      { agent: "churn-risk-detector", on: "payment.failed" },
      { agent: "churn-risk-detector", on: "review.negative" },
      { agent: "churn-risk-detector", on: "margin.collapsed" },
      { agent: "churn-risk-detector", on: "contract.nonrenewal.approaching", emits: "churn.risk.flagged" },
      { agent: "save-play", on: "churn.risk.flagged", note: "founder runs the save" },
    ],
  },
  {
    id: "E.5",
    name: "Infra / Security alert routing",
    owner: "Infrastructure (availability) + Security (integrity)",
    steps: [
      { agent: "incident-responder", on: "connector.down.p0" },
      { agent: "incident-responder", on: "runner.stuck.quarantined" },
      { agent: "secrets-rotation", on: "auth.expiring" },
      { agent: "incident-responder", on: "isolation.test.failed", note: "isolation FAIL → BLOCK release + P0" },
      { agent: "security-anomaly-watchdog", emits: "security.anomaly", note: "containment proposal + founder" },
    ],
  },
  {
    id: "E.6",
    name: "Learning loop (the compounding flywheel)",
    owner: "Knowledge Mgmt (D6.2) + Agent Team Mgmt (D7.1)",
    steps: [
      // memory-consolidator runs nightly (cron, seeded) and emits the proposals below.
      { agent: "skill-librarian", on: "pattern.recurring", emits: "skill.proposed" },
      { agent: "agent-evaluator", on: "eval.case.proposed" },
      { agent: "agent-evaluator", on: "skill.proposed", emits: "agent.change.validated" },
      { agent: "agent-onboarder", on: "agent.change.validated", note: "promote if it improves outcomes" },
    ],
  },
];
