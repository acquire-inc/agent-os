// Pure test for the tool catalog's truthfulness + safety classification (Phase 9, 09-01). No DB.
// Run: pnpm --filter @agent-os/seed exec tsx _tools.test.ts
import { KNOWN_TOOLS, ACTION_TOOLS, toolMeta, humanizeToolKey } from "./_tools.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// Named tools the doctrine prompts reference (the set that must NOT fall back to the generic stub).
// Mirrors the `tool.<word>` refs found across docs/ — keep in sync as the doctrine grows.
const REFERENCED_NAMED = [
  "agent-registry", "spawn-agent", "pause-agent", "archive-agent", "reactivate-agent",
  "billing-engine", "payment-bridge", "bill-pay-bridge", "dunning-engine", "commission-ledger",
  "loyalty-milestones", "revenue-ledger", "ar-ledger", "cash-feed", "expense-feed", "budget-engine",
  "unit-economics-engine", "forecast-model", "reinvestment-model", "margin-monitor",
  "contract-engine", "contract-tracker", "price-book", "pricing-recommender-engine", "offer-registry",
  "offer-test-tracker", "packaging-experiment-tracker", "deal-desk", "client-health-score",
  "churn-signal-engine", "expansion-detector", "show-rate-tracker", "referral-attribution",
  "onboarding-orchestrator", "qbr-builder", "objection-knowledge", "save-play-library",
  "discovery-brief", "competitor-radar", "competitor-offer-scraper", "geo-scout", "vertical-scout",
  "partnership-radar", "review-monitor", "win-signal-engine", "content-calendar",
  "transcript-to-content", "video-clip-finder", "proof-vault", "partner-asset-gen", "partner-registry",
  "vendor-registry", "arcads-launcher", "funnel-events", "deploy-bridge", "code-review-bot",
  "error-watch", "incident-log", "runner-telemetry", "rate-limit-tracker", "platform-changelog-watcher",
  "data-quality-monitor", "connector-healthcheck", "event-schema-registry", "browser", "calendar-bridge",
  "knowledge-index", "memory-consolidation-engine", "compliance-ruleset", "risk-register",
  "isolation-test-suite", "vault-auditor", "access-log-analyzer", "agent-eval-suite",
  "agent-performance-tracker", "skill-registry-stats", "capacity-model",
].map((k) => `tool.${k}`);

// Tools that take an irreversible, high-stakes external action → MUST be approval + irreversible.
const MUST_BE_GATED = [
  "tool.billing-engine", "tool.payment-bridge", "tool.bill-pay-bridge", "tool.dunning-engine",
  "tool.commission-ledger", "tool.loyalty-milestones", "tool.contract-engine", "tool.arcads-launcher",
  "tool.deploy-bridge",
  // Workforce mutations — all four are high-stakes by definition.
  "tool.spawn-agent", "tool.pause-agent", "tool.archive-agent", "tool.reactivate-agent",
];

function main() {
  // ── T2: every referenced named tool has REAL metadata (no generic stub fallback) ──
  const stubbed = REFERENCED_NAMED.filter((k) => !KNOWN_TOOLS[k]);
  assert(stubbed.length === 0, `every referenced named tool is catalogued (no stubs)${stubbed.length ? " — missing: " + stubbed.join(", ") : ""}`);
  // The two previously-missing numbered tools are now real, too.
  assert(Boolean(KNOWN_TOOLS["tool.10"]) && Boolean(KNOWN_TOOLS["tool.14"]), "tool.10 + tool.14 are catalogued");

  // No catalogued tool carries the generic stub description.
  const generic = Object.entries(KNOWN_TOOLS).filter(([, m]) => /^Deterministic tool:/.test(m.description));
  assert(generic.length === 0, "no catalogued tool uses the generic stub description");

  // ── T1: high-stakes tools are approval + irreversible ──
  for (const k of MUST_BE_GATED) {
    const m = KNOWN_TOOLS[k]!;
    assert(m && m.requiresApproval && !m.reversible, `${k} is approval-gated + irreversible`);
  }

  // ── Invariant (mirrors validateTool): irreversible ⇒ requiresApproval, across the WHOLE catalog ──
  const invariantBreaks = Object.entries(KNOWN_TOOLS).filter(([, m]) => !m.reversible && !m.requiresApproval);
  assert(invariantBreaks.length === 0, `every irreversible tool requires approval${invariantBreaks.length ? " — breaks: " + invariantBreaks.map(([k]) => k).join(", ") : ""}`);

  // ── Defense-in-depth: ACTION_TOOLS fallback agrees with KNOWN_TOOLS for the gated set ──
  for (const k of MUST_BE_GATED) {
    if (KNOWN_TOOLS[k]) continue; // catalogued entry is authoritative
    const m = toolMeta(k);
    assert(m.requiresApproval && !m.reversible, `${k} fallback is gated via ACTION_TOOLS`);
  }
  // A truly-unknown tool still gets a humanized name + safe default.
  const unknown = toolMeta("tool.some-unknown-thing");
  assert(unknown.name === "Some Unknown Thing" && unknown.reversible && !unknown.requiresApproval, "unknown tool → humanized name + safe default");
  assert(humanizeToolKey("tool.unit-economics-engine") === "Unit Economics Engine", "humanizeToolKey works");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
