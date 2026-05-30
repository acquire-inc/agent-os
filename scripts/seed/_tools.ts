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
  "tool.11": { name: "Pixel Health Monitor", description: "Verifies tracking/pixel integrity upstream of optimization.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.12": { name: "Account-Health Scorer", description: "Ban-resilience moat — scores ad-account health.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.13": { name: "Quiz/Form Engine", description: "acqu.io/apply + /quiz with A2P-compliant consent.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.15": { name: "Twilio A2P Sender", description: "Sends A2P-compliant SMS via Twilio.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.16": { name: "Resend / Agent-Mail Sender", description: "Sends transactional/agent email.", kind: "custom", requiresApproval: true, reversible: false },
  "tool.17": { name: "Slack Approvals Bridge", description: "The universal human approval interface in Slack.", kind: "mcp", requiresApproval: false, reversible: true },
  "tool.18": { name: "Close Adapter", description: "Close CRM read/write.", kind: "mcp", requiresApproval: false, reversible: true },
  "tool.19": { name: "Attribution Joiner", description: "Links Meta results → Close deals.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.20": { name: "Stagehand Browser Toolkit", description: "Shared AI-browser automation (Stagehand on Browserbase).", kind: "custom", requiresApproval: false, reversible: true },
  // ── Universal infra tools (bound to every agent) ──
  "tool.21": { name: "Vector DB", description: "pgvector retrieval, scoped per tenant/project.", kind: "custom", requiresApproval: false, reversible: true },
  "tool.22": { name: "Run-Summary Writer", description: "Forces the run-summary contract into run_summaries (needed by every agent).", kind: "custom", requiresApproval: false, reversible: true },
};

// Named tools whose action is clearly side-effecting/external → approval + irreversible.
export const ACTION_TOOLS = new Set<string>([
  "tool.payment-bridge",
  "tool.bill-pay-bridge",
  "tool.contract-engine",
  "tool.billing-engine",
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
