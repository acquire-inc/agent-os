// scripts/seed/_roster.ts
// The full main-doctrine §1.5 roster (55 agents), grouped into the v2 Part F phases.
// Phase 1 (9) is seeded by the dedicated scripts (acqu-vitals + seed-phase-1). Phases
// 2–5 below cover the remaining 46, each {key, doc, tier}; the generic seeder pulls the
// verbatim prompt from `doc` and the model from `tier`. Tier per main §1.5 (+ manifest).

import type { AgentSpec } from "./_generic.js";

// Phase 2 — Creative engine + the compliance gate (Part F).
export const PHASE_2: AgentSpec[] = [
  { key: "creative-miner", doc: "v1", tier: "T-work", extraSkills: ["creative-generation"] },
  { key: "creative-studio", doc: "v1", tier: "T-work", extraSkills: ["creative-generation", "content-engine"] },
  { key: "weekly-report", doc: "v1", tier: "T-work", extraSkills: ["weekly-client-reporting"] },
  { key: "ad-claim-compliance", doc: "v2", tier: "T-critical" }, // can't-fail — Claude, never Hermes
  { key: "case-study-builder", doc: "v2", tier: "T-work" },
];

// Phase 3 — Client-facing fulfillment + revenue ops (Part F).
export const PHASE_3: AgentSpec[] = [
  { key: "launcher", doc: "v1", tier: "T-work" },
  { key: "lead-triage", doc: "v1", tier: "T-cheap", extraSkills: ["lead-routing-qualification"] },
  { key: "booking-concierge", doc: "v1", tier: "T-cheap" },
  { key: "funnel-monitor", doc: "v1", tier: "T-cheap" },
  { key: "onboarding-runner", doc: "v1", tier: "T-work", extraSkills: ["client-onboarding"] },
  { key: "client-comms", doc: "v1", tier: "T-work", extraSkills: ["weekly-client-reporting"] },
  { key: "client-health", doc: "v1", tier: "T-cheap", extraSkills: ["client-health-scan"] },
  { key: "churn-risk-detector", doc: "v1", tier: "T-work", extraSkills: ["churn-risk-detection"] },
  { key: "ar-aging-monitor", doc: "v2", tier: "T-cheap" },
  { key: "cash-position-monitor", doc: "v2", tier: "T-cheap" },
  { key: "billing-runner", doc: "v2", tier: "T-cheap" },
];

// Phase 4 — The moat + the meta-layer (Part F).
export const PHASE_4: AgentSpec[] = [
  { key: "intel", doc: "v1", tier: "T-work" },
  { key: "decision-memo-drafter", doc: "v1", tier: "T-critical" }, // can't-fail
  { key: "save-play", doc: "v1", tier: "T-work" },
  { key: "expansion-finder", doc: "v1", tier: "T-reason" },
  { key: "discovery-prep", doc: "v1", tier: "T-work", extraSkills: ["proposal-drafting"] },
  { key: "call-summarizer", doc: "v1", tier: "T-work" },
  { key: "contract-drafter", doc: "v1", tier: "T-critical" }, // can't-fail
  { key: "unit-economics", doc: "v1", tier: "T-reason" },
  { key: "contract-lifecycle-manager", doc: "v2", tier: "T-critical" }, // can't-fail
  { key: "risk-register-keeper", doc: "v2", tier: "T-critical" }, // can't-fail
  { key: "pricing-architect", doc: "v2", tier: "T-critical" }, // can't-fail
  { key: "discount-governor", doc: "v2", tier: "T-critical" }, // can't-fail
  { key: "reinvestment-advisor", doc: "v2", tier: "T-critical" }, // can't-fail
  { key: "forecast-runner", doc: "v1", tier: "T-reason" }, // v2 block is a stub → pull v1 prompt
];

// Phase 5 — Productize externally + security/reliability/intel suite (Part F).
export const PHASE_5: AgentSpec[] = [
  { key: "tenant-isolation-tester", doc: "v2", tier: "T-critical" }, // can't-fail — external gate
  { key: "access-auditor", doc: "v2", tier: "T-critical" }, // can't-fail
  { key: "security-anomaly-watchdog", doc: "v2", tier: "T-critical" }, // can't-fail
  { key: "runner-ops", doc: "v2", tier: "T-cheap" },
  { key: "rate-limit-guardian", doc: "v2", tier: "T-cheap" },
  { key: "loyalty-rewarder", doc: "v1", tier: "T-cheap" },
  { key: "attribution-reconciler", doc: "v1", tier: "T-cheap" },
  { key: "pixel-watcher", doc: "v1", tier: "T-cheap" },
  { key: "competitor-watchtower", doc: "v2", tier: "T-reason", extraSkills: ["competitor-ad-teardown"] },
  { key: "market-signal-scanner", doc: "v2", tier: "T-reason" },
  { key: "vertical-scout", doc: "v1", tier: "T-reason" },
  { key: "packaging-experimenter", doc: "v2", tier: "T-reason" },
  { key: "event-schema-guardian", doc: "v1", tier: "T-cheap" },
  { key: "expense-anomaly", doc: "v1", tier: "T-cheap" },
  { key: "offer-architect", doc: "v1", tier: "T-critical" }, // can't-fail
  { key: "offer-validator", doc: "v1", tier: "T-critical" }, // can't-fail
  { key: "cliently.dev", doc: "v1", tier: "T-critical" }, // can't-fail — code-writing on Claude
];

export const ALL_PHASES: Record<string, AgentSpec[]> = {
  "Phase 2": PHASE_2,
  "Phase 3": PHASE_3,
  "Phase 4": PHASE_4,
  "Phase 5": PHASE_5,
};
