// Pure test for role-based connector enrichment (Phase 9, 09-02). No DB.
// Run: pnpm --filter @agent-os/seed exec tsx _connectors.test.ts
import { roleConnectors, ROLE_CONNECTORS } from "./_connectors.js";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// Seeded connector names (fixtures). Every connector the role map references MUST be one of these,
// or enrichment would silently skip it.
const SEEDED = new Set([
  "Close", "Pipeboard × Meta", "Slack", "Google Drive", "Fireflies", "Gmail", "pgvector Knowledge",
  "GitHub", "Playwright", "HubSpot", "Stripe", "QuickBooks", "Notion", "Google Calendar", "Apollo",
  "Twilio", "Intercom", "Airtable", "n8n", "Telegram", "Linear", "Sentry", "Vercel",
]);

function main() {
  // ── the gaps the audit found are closed ──
  assert(roleConnectors("dunning-manager").includes("Stripe"), "dunning-manager → Stripe");
  assert(roleConnectors("billing-runner").includes("Stripe"), "billing-runner → Stripe");
  assert(roleConnectors("expense-tracker").includes("QuickBooks"), "expense-tracker → QuickBooks");
  assert(roleConnectors("expense-anomaly").includes("QuickBooks"), "expense-anomaly → QuickBooks");
  assert(roleConnectors("unit-economics").includes("QuickBooks"), "unit-economics → QuickBooks");
  assert(roleConnectors("cliently.dev").includes("GitHub"), "cliently.dev → GitHub");
  assert(roleConnectors("runner-ops").includes("Sentry"), "runner-ops → Sentry");
  assert(roleConnectors("ea").includes("Google Calendar"), "ea → Google Calendar");
  assert(roleConnectors("booking-concierge").includes("Google Calendar"), "booking-concierge → Calendar");
  assert(roleConnectors("call-summarizer").includes("Fireflies"), "call-summarizer → Fireflies");
  assert(roleConnectors("connector-health-monitor").includes("n8n"), "connector-health-monitor → n8n");
  assert(roleConnectors("client-health").includes("Intercom"), "client-health → Intercom");
  assert(roleConnectors("contract-drafter").includes("Close"), "contract-drafter → Close");

  // ── every connector the map references is actually seeded (no silent skips) ──
  const referenced = [...new Set(ROLE_CONNECTORS.flatMap((r) => r.connectors))];
  const unseeded = referenced.filter((c) => !SEEDED.has(c));
  assert(unseeded.length === 0, `every role connector is in the seeded catalog${unseeded.length ? " — not seeded: " + unseeded.join(", ") : ""}`);

  // ── a role with no clear connector need gets nothing (don't over-bind) ──
  assert(roleConnectors("pricing-architect").length === 0, "pricing-architect → no role connectors (compute-only)");
  assert(roleConnectors("offer-validator").length === 0, "offer-validator → no role connectors");

  // ── output is deduped ──
  const dunning = roleConnectors("dunning-manager");
  assert(new Set(dunning).size === dunning.length, "roleConnectors output is deduped");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
