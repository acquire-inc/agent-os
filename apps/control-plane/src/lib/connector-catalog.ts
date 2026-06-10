// Connector marketplace catalog — real MCP servers / SaaS connectors an operator
// can browse and add. Adding one creates a user MCP (via the connector store) so
// it works end-to-end in demo mode. Curated 2026-06 via an ultracode research pass.
import type { McpAuthType, Mcp, McpTransport } from "@agent-os/shared";
import { newMcpId } from "./connector-store";

export interface CatalogEntry {
  name: string;
  category: string;
  auth: McpAuthType;
  purpose: string;
}

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  // CRM
  { name: "Salesforce", category: "CRM", auth: "oauth", purpose: "Manage enterprise CRM records, leads, opportunities, and accounts." },
  { name: "Zoho CRM", category: "CRM", auth: "oauth", purpose: "Manage contacts, deals, and sales pipelines in Zoho's CRM suite." },
  { name: "Pipedrive", category: "CRM", auth: "api_key", purpose: "Track deals and sales pipeline stages for SMB sales teams." },
  // Marketing
  { name: "Mailchimp", category: "Marketing", auth: "oauth", purpose: "Manage email campaigns, audiences, and marketing automation." },
  { name: "Klaviyo", category: "Marketing", auth: "api_key", purpose: "Run e-commerce email and SMS marketing flows and segmentation." },
  { name: "Google Ads", category: "Marketing", auth: "oauth", purpose: "Manage search and display ad campaigns and pull performance data." },
  { name: "Google Analytics (GA4)", category: "Marketing", auth: "oauth", purpose: "Query website and app traffic, events, and conversion analytics." },
  { name: "SendGrid", category: "Marketing", auth: "api_key", purpose: "Send transactional and marketing email at scale via API." },
  // Finance
  { name: "PayPal", category: "Finance", auth: "oauth", purpose: "Process payments, refunds, and retrieve transaction history." },
  { name: "Plaid", category: "Finance", auth: "api_key", purpose: "Connect bank accounts and fetch balances, transactions, and identity." },
  { name: "Xero", category: "Finance", auth: "oauth", purpose: "Manage invoices, bills, and accounting ledgers for small businesses." },
  { name: "Brex", category: "Finance", auth: "api_key", purpose: "Access corporate card transactions, expenses, and spend data." },
  // Data
  { name: "PostgreSQL", category: "Data", auth: "none", purpose: "Query and inspect Postgres databases with read/write SQL access." },
  { name: "Filesystem", category: "Data", auth: "none", purpose: "Read, write, and search local files within allowed directories." },
  { name: "Snowflake", category: "Data", auth: "api_key", purpose: "Run SQL queries against the Snowflake cloud data warehouse." },
  { name: "Google BigQuery", category: "Data", auth: "oauth", purpose: "Query large-scale analytics datasets in Google's data warehouse." },
  { name: "MongoDB", category: "Data", auth: "api_key", purpose: "Query and manage documents in MongoDB collections." },
  { name: "Redis", category: "Data", auth: "none", purpose: "Read and write key-value data and caches in Redis." },
  { name: "Supabase", category: "Data", auth: "api_key", purpose: "Manage Postgres database, auth, and storage on the Supabase platform." },
  // Dev
  { name: "AWS", category: "Dev", auth: "api_key", purpose: "Manage AWS cloud resources, S3, Lambda, and infrastructure." },
  { name: "Cloudflare", category: "Dev", auth: "api_key", purpose: "Manage DNS, Workers, R2 storage, and edge configuration." },
  { name: "Puppeteer", category: "Dev", auth: "none", purpose: "Automate Chromium browsers for scraping and end-to-end testing." },
  { name: "GitLab", category: "Dev", auth: "oauth", purpose: "Manage repos, merge requests, issues, and CI pipelines." },
  { name: "Jira", category: "Dev", auth: "oauth", purpose: "Track issues, sprints, and agile boards in Atlassian Jira." },
  { name: "Docker", category: "Dev", auth: "none", purpose: "Manage containers, images, and Docker workloads locally." },
  { name: "Datadog", category: "Dev", auth: "api_key", purpose: "Query metrics, logs, and monitors for application observability." },
  // Comms
  { name: "Discord", category: "Comms", auth: "api_key", purpose: "Send messages, manage channels, and read community servers." },
  { name: "Microsoft Teams", category: "Comms", auth: "oauth", purpose: "Send messages and manage chats and channels in Teams." },
  { name: "WhatsApp Business", category: "Comms", auth: "api_key", purpose: "Send and receive business messages over the WhatsApp API." },
  { name: "Microsoft Outlook", category: "Comms", auth: "oauth", purpose: "Read, send, and manage email and contacts in Outlook/Microsoft 365." },
  // Productivity
  { name: "Google Sheets", category: "Productivity", auth: "oauth", purpose: "Read and write spreadsheet data and formulas in Google Sheets." },
  { name: "Asana", category: "Productivity", auth: "oauth", purpose: "Manage tasks, projects, and team workflows in Asana." },
  { name: "Trello", category: "Productivity", auth: "api_key", purpose: "Manage boards, lists, and cards for kanban-style project tracking." },
  { name: "ClickUp", category: "Productivity", auth: "oauth", purpose: "Manage tasks, docs, and projects in the ClickUp workspace." },
  { name: "Monday.com", category: "Productivity", auth: "oauth", purpose: "Manage work boards, items, and team project workflows." },
  { name: "Confluence", category: "Productivity", auth: "oauth", purpose: "Create and search team documentation and wiki pages." },
  { name: "Zapier", category: "Productivity", auth: "oauth", purpose: "Trigger thousands of app integrations and automation workflows." },
  // Support
  { name: "Zendesk", category: "Support", auth: "oauth", purpose: "Manage support tickets, agents, and customer help desk workflows." },
  { name: "Freshdesk", category: "Support", auth: "api_key", purpose: "Handle support tickets and customer service operations." },
  // Social
  { name: "Brave Search", category: "Social", auth: "api_key", purpose: "Run privacy-focused web and local search queries via API." },
  { name: "X (Twitter)", category: "Social", auth: "oauth", purpose: "Post tweets, read timelines, and search social content." },
  { name: "LinkedIn", category: "Social", auth: "oauth", purpose: "Publish posts and manage company page and profile content." },
  { name: "YouTube", category: "Social", auth: "oauth", purpose: "Manage videos, playlists, and channel analytics." },
  // E-commerce
  { name: "Shopify", category: "E-commerce", auth: "oauth", purpose: "Manage products, orders, inventory, and storefronts." },
  { name: "WooCommerce", category: "E-commerce", auth: "api_key", purpose: "Manage products and orders for WordPress-based online stores." },
  { name: "BigCommerce", category: "E-commerce", auth: "api_key", purpose: "Manage catalog, orders, and customers for online retail stores." },
];

export const CATALOG_CATEGORIES: string[] = [...new Set(CONNECTOR_CATALOG.map((c) => c.category))];

export function catalogEntryToMcp(tenantId: string, entry: CatalogEntry, projectId: string | null): Mcp {
  const transport: McpTransport = entry.auth === "none" ? "stdio" : "http";
  return {
    id: newMcpId(),
    tenantId,
    projectId,
    name: entry.name,
    transport,
    endpoint: null,
    authType: entry.auth,
    scope: projectId ? "project" : "global",
    status: entry.auth === "none" ? "connected" : "disconnected",
    lastHealthCheck: null,
    tags: [entry.category.toLowerCase()],
  };
}
