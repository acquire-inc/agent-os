// scripts/seed/_connectors.ts — role-based connector enrichment (Phase 9, 09-02).
//
// The doctrine prompts only declare slack/close/gdrive on their `MCPs:` lines, so agents end up
// under-connected for their actual function (dunning-manager with no Stripe, expense-tracker with
// no QuickBooks, the dev agent with no GitHub, the EA with no Calendar). This module adds, as an
// ADDITIVE pass, the connectors a role clearly needs — keyed off the agent key. It only ever binds
// connectors that are already seeded (mapped names below match fixtures); it never removes a
// doctrine-parsed binding. Pure decision (`roleConnectors`) + DB pass (`enrichConnectors`).
//
// This is DATA/config, consistent with "agents are data". Connection STATUS (connected vs
// needs_reauth) is a separate go-live credential step (vault/Nango), not handled here.
import { schema, type Db } from "@agent-os/db";
import { TENANT_IDS } from "@agent-os/shared";
import { and, eq, sql } from "drizzle-orm";

const TENANT_ID = TENANT_IDS.acqu;

// key pattern → seeded connector names to ensure bound. Names must match the seeded MCP catalog.
// Patterns are matched against the agent key; an agent may match several rows (union of all).
export const ROLE_CONNECTORS: { re: RegExp; connectors: string[] }[] = [
  { re: /dunning|billing|aging|collections|^ar-/, connectors: ["Stripe", "Close"] },
  { re: /expense|spend|payable|bookkeep/, connectors: ["QuickBooks", "Stripe"] },
  { re: /margin|unit-econ|forecast|reinvest|cash|treasury|revenue/, connectors: ["QuickBooks", "Stripe"] },
  { re: /^ea$|assistant|briefing|booking|schedul|calendar/, connectors: ["Google Calendar", "Gmail"] },
  { re: /call-sum|discovery-prep|transcript|meeting/, connectors: ["Fireflies", "Google Calendar"] },
  { re: /cliently\.dev|deploy|release/, connectors: ["GitHub", "Vercel", "Linear"] },
  { re: /runner-ops|incident|reliab|uptime|rate-limit/, connectors: ["Sentry", "GitHub"] },
  { re: /security|access-aud|anomaly|isolation|vault/, connectors: ["Sentry", "GitHub"] },
  { re: /connector-health|integration|event-schema|platform/, connectors: ["n8n"] },
  { re: /lead|prospect|expansion-find|intel/, connectors: ["Apollo", "Close"] },
  { re: /client-health|churn|onboard|loyal|success|qbr|save-play/, connectors: ["Close", "Intercom"] },
  { re: /comms|nurture|reminder|outreach/, connectors: ["Close", "Gmail"] },
  { re: /contract|deal|proposal/, connectors: ["Close"] },
  { re: /creative|case-study|content|weekly-report|brand|social/, connectors: ["Google Drive", "Notion"] },
];

/** Pure: the seeded connector names a given agent key should also be bound to (deduped). */
export function roleConnectors(agentKey: string): string[] {
  const out = new Set<string>();
  for (const { re, connectors } of ROLE_CONNECTORS) {
    if (re.test(agentKey)) for (const c of connectors) out.add(c);
  }
  return [...out];
}

export interface EnrichReport {
  agentKey: string;
  added: string[];
  missing: string[]; // role connectors not seeded for Acqu (skipped, not fatal)
}

/**
 * Additive, idempotent pass over every Acqu agent: ensure each is bound to the connectors its role
 * needs (on top of whatever the doctrine parsed). Never prunes. Connectors not present in the
 * seeded catalog are skipped and reported (not fatal — they may be seeded later). Run LAST, after
 * the per-agent/roster seeders (which prune via setMcps).
 */
export async function enrichConnectors(db: Db): Promise<EnrichReport[]> {
  const agents = await db
    .select({ id: schema.agents.id, key: schema.agents.key })
    .from(schema.agents)
    .where(eq(schema.agents.tenantId, TENANT_ID));

  // name → mcp id (only those seeded for Acqu).
  const mcpRows = await db
    .select({ id: schema.mcps.id, name: schema.mcps.name })
    .from(schema.mcps)
    .where(eq(schema.mcps.tenantId, TENANT_ID));
  const idByName = new Map(mcpRows.map((m) => [m.name, m.id]));

  const reports: EnrichReport[] = [];
  for (const a of agents) {
    const wanted = roleConnectors(a.key);
    if (!wanted.length) continue;
    const added: string[] = [];
    const missing: string[] = [];
    for (const name of wanted) {
      const mcpId = idByName.get(name);
      if (!mcpId) { missing.push(name); continue; }
      // Additive: existing binding is left intact (on conflict do nothing).
      const res = await db.execute(
        sql`insert into agent_mcps (agent_id, mcp_id) values (${a.id}, ${mcpId}) on conflict do nothing`,
      );
      // rowCount is driver-specific; record the intent regardless (idempotent either way).
      added.push(name);
      void res;
    }
    reports.push({ agentKey: a.key, added, missing });
  }
  return reports;
}
