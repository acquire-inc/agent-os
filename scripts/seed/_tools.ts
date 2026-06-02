// scripts/seed/_tools.ts
// The deterministic-tool catalog, as DATA. The full catalog and every binding are *derived
// from the seeded agent prompts* (which carry the doctrine's `Tools:` refs) — so this file
// only supplies metadata: human names, descriptions, and the safety classification
// (kind / requires_approval / reversible) for the tools the doctrine names. Tools referenced
// but not described here get a humanized name + safe defaults (custom, no-approval, reversible).

export type ToolMeta = {
  name: string;
  description: string;
  kind: "custom" | "mcp";
  requiresApproval: boolean;
  reversible: boolean;
};

// Known classifications. ACTION = side-effecting/external → approval + irreversible.
// MCP = backed by a connector. Everything else defaults to a reversible internal tool.
export const KNOWN_TOOLS: Record<string, ToolMeta> = {
  // ── Numbered master catalog (doctrine Part 4) ──
  "tool.1": { name: "Meta Adapter", description: "Meta read/write API layer via Pipeboard.", kind: "mcp", requiresApproval: false, reversible: true },
  "tool.2": { name: "Ad Launcher", description: "Pushes ads to Meta PAUSED by default, dry-run diff, $10 budget lock.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.4": { name: "Rules Engine", description: "The color-coded ad rules as code (move/kill proposals).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.5": { name: "One-Change-Per-Day Enforcer", description: "The discipline constraint on ad-account changes.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.6": { name: "Creative DB", description: "Variant lineage, briefs, lifetime perf, winner score, swipe-file.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.7": { name: "Meta Ad Library Scraper", description: "Scrapes the Meta Ad Library (Stagehand + Library API).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.8": { name: "Winning-Ad Finder & Cloner", description: "The 2hr → 30sec winning-ad discovery/clone workflow.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.9": { name: "Image-Hash Dedup", description: "Perceptual-hash dedup of creative images.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.10": { name: "UTM Headline Swapper", description: "Swaps UTM-driven headlines/copy on landers for message-match testing.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.11": { name: "Pixel Health Monitor", description: "Verifies tracking/pixel integrity upstream of optimization.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.12": { name: "Account-Health Scorer", description: "Ban-resilience moat — scores ad-account health.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.13": { name: "Quiz/Form Engine", description: "acqu.io/apply + /quiz with A2P-compliant consent.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.14": { name: "Dynamic-Lander Factory", description: "Generates/publishes dynamic landing pages (reversible — can be unpublished).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.15": { name: "Twilio A2P Sender", description: "Sends A2P-compliant SMS via Twilio.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.16": { name: "Resend / Agent-Mail Sender", description: "Sends transactional/agent email.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.17": { name: "Slack Approvals Bridge", description: "The universal human approval interface in Slack.", kind: "mcp", requiresApproval: false, reversible: true },
  "tool.18": { name: "Close Adapter", description: "Close CRM read/write.", kind: "mcp", requiresApproval: false, reversible: true },
  "tool.19": { name: "Attribution Joiner", description: "Links Meta results → Close deals.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.20": { name: "Stagehand Browser Toolkit", description: "Shared AI-browser automation (Stagehand on Browserbase).", kind: "custom", requiresApproval: false, reversible: true },
  // ── Universal infra tools (bound to every agent) ──
  "tool.21": { name: "Vector DB", description: "pgvector retrieval, scoped per tenant/project.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.22": { name: "Run-Summary Writer", description: "Forces the run-summary contract into run_summaries (needed by every agent).", kind: "custom", requiresApproval: false, reversible: true },

  // ── Workforce / org-design tools (the agent-architect's hands) ──
  // The registry read is safe; every MUTATION is approval-gated + irreversible so the autonomy
  // gate forces a human to sign off before the team can hire/bench/fire — even on full autonomy.
  "tool.agent-registry": { name: "Agent Registry", description: "Source-of-truth read over every agent (key, status, autonomy, model, KPIs, last run).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.spawn-agent": { name: "Spawn Agent", description: "Hire: create a new agent as DATA, landing 'proposed' + disabled until a human approves it.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.pause-agent": { name: "Pause Agent", description: "Bench an agent (status=paused, disabled). Reversible, keeps its config.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.archive-agent": { name: "Archive Agent", description: "Fire/retire an agent (status=archived, disabled). Terminal unless reactivated.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.reactivate-agent": { name: "Reactivate Agent", description: "Bring a benched/retired agent back to active (enabled).", kind: "custom", requiresApproval: true, reversible: false },

  // ── Named domain tools (doctrine v2 Part 4 expansion). Truthful metadata so the registry's
  //    requires_approval/reversible — authoritative over the verb heuristic at the gate — is
  //    correct. HIGH-STAKES = side-effecting/external/irreversible (money out, deploys, contracts,
  //    ad launches, customer dunning) → approval + irreversible. Everything else is a reversible
  //    read/compute/record. (Real runtime impls are built per-agent at go-live — T3, deferred.) ──

  // Finance & billing
  "tool.billing-engine": { name: "Billing Engine", description: "Creates/charges invoices and subscriptions. Moves money.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.payment-bridge": { name: "Payment Bridge", description: "Initiates outbound payments / charges via the payment processor.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.bill-pay-bridge": { name: "Bill-Pay Bridge", description: "Pays vendor bills / AP outflows.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.dunning-engine": { name: "Dunning Engine", description: "Runs the dunning sequence — retries failed charges and sends overdue notices.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.commission-ledger": { name: "Commission Ledger", description: "Computes and records partner/rep commission payouts.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.loyalty-milestones": { name: "Loyalty Milestones", description: "Grants loyalty rewards/credits on milestone triggers (issues value).", kind: "custom", requiresApproval: true, reversible: false },
  "tool.revenue-ledger": { name: "Revenue Ledger", description: "Records recognized revenue (correctable via adjusting entries).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.ar-ledger": { name: "AR Ledger", description: "Accounts-receivable ledger (invoices outstanding/aging).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.cash-feed": { name: "Cash Feed", description: "Read-only bank/cash-balance feed.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.expense-feed": { name: "Expense Feed", description: "Read-only expense/transaction feed for categorization + tracking.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.budget-engine": { name: "Budget Engine", description: "Computes budgets vs. actuals; proposes allocations.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.unit-economics-engine": { name: "Unit-Economics Engine", description: "Computes CAC/LTV/margin/payback unit economics.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.forecast-model": { name: "Forecast Model", description: "Revenue/cashflow/pipeline forecasting (read/compute).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.reinvestment-model": { name: "Reinvestment Model", description: "Models reinvestment scenarios for the reinvestment advisor.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.margin-monitor": { name: "Margin Monitor", description: "Watches margin by client/offer; flags erosion.", kind: "custom", requiresApproval: false, reversible: true },

  // Contracts, pricing & offers
  "tool.contract-engine": { name: "Contract Engine", description: "Drafts/sends/executes contracts (binding, external).", kind: "custom", requiresApproval: true, reversible: false },
  "tool.contract-tracker": { name: "Contract Tracker", description: "Read view of contract lifecycle/renewal state.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.price-book": { name: "Price Book", description: "Canonical price/packaging reference (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.pricing-recommender-engine": { name: "Pricing Recommender", description: "Recommends prices/discounts (proposal, not application).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.offer-registry": { name: "Offer Registry", description: "Source-of-truth read over offers and their config.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.offer-test-tracker": { name: "Offer-Test Tracker", description: "Tracks offer/packaging experiments and results.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.packaging-experiment-tracker": { name: "Packaging-Experiment Tracker", description: "Tracks packaging experiments and outcomes.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.deal-desk": { name: "Deal Desk", description: "Assembles deal terms/approvals for review (proposal).", kind: "custom", requiresApproval: false, reversible: true },

  // Sales, clients & growth
  "tool.client-health-score": { name: "Client-Health Score", description: "Scores client health/churn risk (read/compute).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.churn-signal-engine": { name: "Churn-Signal Engine", description: "Surfaces churn signals from usage/engagement.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.expansion-detector": { name: "Expansion Detector", description: "Detects upsell/expansion opportunities.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.show-rate-tracker": { name: "Show-Rate Tracker", description: "Tracks booked→showed rates for sales calls.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.referral-attribution": { name: "Referral Attribution", description: "Attributes referrals to sources (record/compute).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.onboarding-orchestrator": { name: "Onboarding Orchestrator", description: "Drives the client onboarding checklist/state.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.qbr-builder": { name: "QBR Builder", description: "Assembles quarterly business reviews from client data.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.objection-knowledge": { name: "Objection Knowledge", description: "Retrieves objection-handling knowledge (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.save-play-library": { name: "Save-Play Library", description: "Library of retention save-plays (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.discovery-brief": { name: "Discovery Brief", description: "Generates discovery-call briefs from CRM context.", kind: "custom", requiresApproval: false, reversible: true },

  // Research, market & competitive
  "tool.competitor-radar": { name: "Competitor Radar", description: "Monitors competitor activity/positioning.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.competitor-offer-scraper": { name: "Competitor-Offer Scraper", description: "Scrapes competitor offers/pricing (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.geo-scout": { name: "Geo Scout", description: "Scouts geographic expansion opportunities.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.vertical-scout": { name: "Vertical Scout", description: "Scouts new vertical/niche opportunities.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.partnership-radar": { name: "Partnership Radar", description: "Surfaces partnership/BD opportunities.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.review-monitor": { name: "Review Monitor", description: "Monitors public reviews/reputation (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.win-signal-engine": { name: "Win-Signal Engine", description: "Detects buying/win signals across channels.", kind: "custom", requiresApproval: false, reversible: true },

  // Content, proof & partners
  "tool.content-calendar": { name: "Content Calendar", description: "Plans/schedules the content calendar.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.transcript-to-content": { name: "Transcript-to-Content", description: "Turns call/meeting transcripts into content drafts.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.video-clip-finder": { name: "Video-Clip Finder", description: "Finds clip-worthy moments in long-form video.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.proof-vault": { name: "Proof Vault", description: "Store of case studies / testimonials / proof assets (read/write records).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.partner-asset-gen": { name: "Partner-Asset Generator", description: "Generates co-marketing assets for partners (drafts).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.partner-registry": { name: "Partner Registry", description: "Source-of-truth read over partners.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.vendor-registry": { name: "Vendor Registry", description: "Source-of-truth read over vendors.", kind: "custom", requiresApproval: false, reversible: true },

  // Ads & launch
  "tool.arcads-launcher": { name: "Arcads Launcher", description: "Generates + launches AI UGC ads (external spend, irreversible).", kind: "custom", requiresApproval: true, reversible: false },
  "tool.funnel-events": { name: "Funnel Events", description: "Funnel/event analytics (read).", kind: "custom", requiresApproval: false, reversible: true },

  // Dev, infra & platform (Cliently.dev + ops)
  "tool.deploy-bridge": { name: "Deploy Bridge", description: "Deploys/promotes builds to an environment (high-stakes, irreversible).", kind: "custom", requiresApproval: true, reversible: false },
  "tool.code-review-bot": { name: "Code-Review Bot", description: "Posts code-review comments/checks on PRs (reversible).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.error-watch": { name: "Error Watch", description: "Watches error/exception streams (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.incident-log": { name: "Incident Log", description: "Records/reads incident timeline entries.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.runner-telemetry": { name: "Runner Telemetry", description: "Reads runner/agent execution telemetry.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.rate-limit-tracker": { name: "Rate-Limit Tracker", description: "Tracks connector/API rate-limit headroom.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.platform-changelog-watcher": { name: "Platform-Changelog Watcher", description: "Watches platform/API changelogs for breaking changes.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.data-quality-monitor": { name: "Data-Quality Monitor", description: "Monitors data quality/freshness across stores.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.connector-healthcheck": { name: "Connector Healthcheck", description: "Probes connector/MCP health + auth status (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.event-schema-registry": { name: "Event-Schema Registry", description: "Source-of-truth read over the event vocabulary/schemas.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.browser": { name: "Browser", description: "AI browser automation (Stagehand/Browserbase) for read/research; mutating actions are gated per-action.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.calendar-bridge": { name: "Calendar Bridge", description: "Reads/writes calendar events (reversible — events can be updated/deleted).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.knowledge-index": { name: "Knowledge Index", description: "Indexes/queries the pgvector knowledge base.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.memory-consolidation-engine": { name: "Memory-Consolidation Engine", description: "Consolidates run summaries into durable agent memory.", kind: "custom", requiresApproval: false, reversible: true },

  // Governance, security & meta
  "tool.compliance-ruleset": { name: "Compliance Ruleset", description: "The ad/claim compliance rules as data (read/evaluate).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.risk-register": { name: "Risk Register", description: "Records/reads enterprise risks.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.isolation-test-suite": { name: "Isolation Test Suite", description: "Runs tenant-isolation (RLS) tests; reports pass/fail (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.vault-auditor": { name: "Vault Auditor", description: "Audits secret/credential vault access (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.access-log-analyzer": { name: "Access-Log Analyzer", description: "Analyzes access logs for anomalies (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.agent-eval-suite": { name: "Agent-Eval Suite", description: "Runs per-agent eval cases; scores outputs (read/compute).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.agent-performance-tracker": { name: "Agent-Performance Tracker", description: "Rolls up agent run/approval metrics (read).", kind: "custom", requiresApproval: false, reversible: true },
  "tool.skill-registry-stats": { name: "Skill-Registry Stats", description: "Reads skill catalog usage/coverage stats.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.capacity-model": { name: "Capacity Model", description: "Models fleet capacity/load for workforce planning.", kind: "custom", requiresApproval: false, reversible: true },
};

// Named tools whose action is clearly side-effecting/external → approval + irreversible.
// Defense-in-depth: `toolMeta()` falls back to this for any side-effecting tool not (yet) in
// KNOWN_TOOLS, so an uncatalogued money/deploy/launch ref can't default to safe+reversible.
// Kept in sync with the high-stakes KNOWN_TOOLS entries (which are authoritative when present).
export const ACTION_TOOLS = new Set<string>([
  "tool.payment-bridge",
  "tool.bill-pay-bridge",
  "tool.contract-engine",
  "tool.billing-engine",
  "tool.dunning-engine",
  "tool.commission-ledger",
  "tool.loyalty-milestones",
  "tool.arcads-launcher",
  "tool.deploy-bridge",
  // Workforce mutations — hiring/benching/firing agents is high-stakes by definition.
  "tool.spawn-agent",
  "tool.pause-agent",
  "tool.archive-agent",
  "tool.reactivate-agent",
]);

// Bound to every agent regardless of prompt refs.
export const UNIVERSAL_TOOLS = ["tool.21", "tool.22"];

/** Humanize a tool key into a name: tool.proof-vault → "Proof Vault". */
export function humanizeToolKey(key: string): string {
  return key.replace(/^tool\./, "").replace(/[-.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Metadata for any tool key — known table first, else humanized name + safe defaults
 *  (ACTION_TOOLS get approval + irreversible). */
export function toolMeta(key: string): ToolMeta {
  if (KNOWN_TOOLS[key]) return KNOWN_TOOLS[key];
  const isAction = ACTION_TOOLS.has(key);
  return {
    name: humanizeToolKey(key),
    description: `Deterministic tool: ${humanizeToolKey(key)}.`,
    kind: "custom",
    requiresApproval: isAction,
    reversible: !isAction,
  };
}

// Single refs: numbered or named (named keys are lowercase, hyphenated).
const SINGLE_RE = /tool\.(\d+|[a-z][a-z0-9-]+)/g;
// Numbered ranges: tool.N–tool.M (en-dash, em-dash, or hyphen between two numbered refs).
const RANGE_RE = /tool\.(\d+)\s*[–—-]\s*tool\.(\d+)/g;

/** Tool keys EXPLICITLY named in a prompt (single refs only — no range expansion).
 *  This is the trustworthy signal for which numbered slots are real tools. */
export function extractSingleToolKeys(prompt: string): string[] {
  return [...prompt.matchAll(SINGLE_RE)].map((m) => `tool.${m[1]}`);
}

/** All tool keys an agent declares: single refs + numbered ranges expanded, where range
 *  output is filtered to `validNumbered` so a literal `tool.1–tool.22` can't invent
 *  undescribed catalog slots (tool.3/10/14 are only seeded if referenced elsewhere). */
export function extractToolKeys(prompt: string, validNumbered: Set<string>): string[] {
  const keys = new Set<string>(extractSingleToolKeys(prompt));
  for (const m of prompt.matchAll(RANGE_RE)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (Number.isInteger(lo) && Number.isInteger(hi) && hi >= lo && hi - lo <= 30) {
      for (let i = lo; i <= hi; i++) {
        const k = `tool.${i}`;
        if (validNumbered.has(k)) keys.add(k);
      }
    }
  }
  return [...keys];
}
