// Per-connector permission scopes — the trust surface for "active access".
// When an operator connects a tool, they see (and can trim) exactly what the
// agent will be able to do with it. Scopes are derived: a specific list for
// well-known connectors, else a sensible set keyed off the connector's
// category/tag, else a generic read/write pair.
import type { Mcp } from "@agent-os/shared";

const SPECIFIC: Record<string, string[]> = {
  Slack: ["channels:read", "chat:write", "users:read", "files:read"],
  Close: ["leads:read", "leads:write", "opportunities:write", "metrics:read"],
  Gmail: ["mail:read", "mail:send", "labels:read"],
  "Google Drive": ["files:read", "files:search"],
  "Google Calendar": ["events:read", "events:write"],
  Stripe: ["charges:read", "refunds:write", "customers:read"],
  GitHub: ["repo:read", "issues:write", "pull_requests:write"],
  HubSpot: ["contacts:read", "contacts:write", "deals:write"],
  Notion: ["pages:read", "pages:write", "search"],
  "Pipeboard × Meta": ["campaigns:read", "adsets:write", "insights:read"],
  Fireflies: ["transcripts:read", "summaries:read"],
  Salesforce: ["records:read", "opportunities:write", "accounts:read"],
  Shopify: ["orders:read", "products:write", "inventory:read"],
  PostgreSQL: ["query:read", "query:write", "schema:read"],
  Discord: ["messages:read", "messages:write", "channels:read"],
  Zendesk: ["tickets:read", "tickets:write", "users:read"],
};

const CATEGORY_SCOPES: Record<string, string[]> = {
  crm: ["contacts:read", "deals:read", "deals:write"],
  sales: ["contacts:read", "deals:read", "deals:write"],
  marketing: ["campaigns:read", "audiences:write", "insights:read"],
  meta: ["campaigns:read", "adsets:write", "insights:read"],
  finance: ["transactions:read", "payments:write"],
  data: ["query:read", "schema:read"],
  systems: ["read", "write"],
  dev: ["repo:read", "issues:write"],
  comms: ["messages:read", "messages:write"],
  ops: ["read", "write", "notify"],
  productivity: ["items:read", "items:write"],
  support: ["tickets:read", "tickets:write"],
  "client-success": ["accounts:read", "notify"],
  social: ["posts:read", "posts:write"],
  "e-commerce": ["orders:read", "products:write"],
  content: ["docs:read", "docs:write"],
  research: ["search", "read"],
};

export function scopesFor(mcp: Pick<Mcp, "name" | "tags" | "authType">): string[] {
  if (SPECIFIC[mcp.name]?.length) return SPECIFIC[mcp.name]!;
  for (const tag of mcp.tags ?? []) {
    if (CATEGORY_SCOPES[tag.toLowerCase()]) return CATEGORY_SCOPES[tag.toLowerCase()]!;
  }
  return mcp.authType === "none" ? ["read"] : ["read", "write"];
}
