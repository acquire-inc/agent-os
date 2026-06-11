// Agent template gallery — deployable archetypes drawn from the Acqu doctrine
// domains. Deploying one creates a user agent (via agent-store) so it works
// end-to-end in demo mode. New agents land in "propose" autonomy per doctrine
// ("new agents start at the cheapest safe tier + propose"); the operator
// promotes them from the control surface.
import type { Agent, Autonomy, ThinkingLevel } from "@agent-os/shared";
import { newAgentId } from "./agent-store";

export interface AgentTemplate {
  key: string;
  name: string;
  category: string;
  persona: string;
  recommendedAutonomy: Autonomy;
  thinkingLevel: ThinkingLevel;
  connectors: string[]; // connector names to bind
  skills: string[];
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    key: "revenue-briefing",
    name: "Revenue Briefing",
    category: "Analytics",
    persona: "Posts a daily revenue, spend, and pipeline briefing every morning.",
    recommendedAutonomy: "execute_safe",
    thinkingLevel: "medium",
    connectors: ["Close", "Pipeboard × Meta", "Slack"],
    skills: ["summarize", "report"],
  },
  {
    key: "lead-router",
    name: "Lead Router",
    category: "Sales",
    persona: "Scores inbound leads and routes the qualified ones to the right AE.",
    recommendedAutonomy: "execute_safe",
    thinkingLevel: "medium",
    connectors: ["Close", "HubSpot", "Slack"],
    skills: ["score", "route"],
  },
  {
    key: "ad-spend-watcher",
    name: "Ad Spend Watcher",
    category: "Marketing",
    persona: "Watches ROAS across ad sets and proposes pauses when spend runs hot.",
    recommendedAutonomy: "propose",
    thinkingLevel: "medium",
    connectors: ["Pipeboard × Meta", "Slack"],
    skills: ["monitor", "analyze"],
  },
  {
    key: "inbox-triage",
    name: "Inbox Triage",
    category: "Ops",
    persona: "Triages inbound email, drafts replies, and flags what needs a human.",
    recommendedAutonomy: "execute_safe",
    thinkingLevel: "low",
    connectors: ["Gmail", "Slack"],
    skills: ["triage", "draft"],
  },
  {
    key: "meeting-summarizer",
    name: "Meeting Summarizer",
    category: "Ops",
    persona: "Summarizes call transcripts into a weekly digest and action items.",
    recommendedAutonomy: "execute_safe",
    thinkingLevel: "medium",
    connectors: ["Fireflies", "Notion", "Slack"],
    skills: ["summarize"],
  },
  {
    key: "churn-watcher",
    name: "Churn Watcher",
    category: "Client success",
    persona: "Flags churn signals in accounts and proposes proactive outreach.",
    recommendedAutonomy: "propose",
    thinkingLevel: "high",
    connectors: ["Close", "Slack"],
    skills: ["monitor", "analyze"],
  },
  {
    key: "invoice-reconciler",
    name: "Invoice Reconciler",
    category: "Finance",
    persona: "Reconciles Stripe charges against the ledger and flags mismatches.",
    recommendedAutonomy: "propose",
    thinkingLevel: "medium",
    connectors: ["Stripe", "QuickBooks"],
    skills: ["reconcile"],
  },
  {
    key: "standup-bot",
    name: "Standup Bot",
    category: "Ops",
    persona: "Collects async standup updates and posts a summary to the team channel.",
    recommendedAutonomy: "execute_full",
    thinkingLevel: "low",
    connectors: ["Slack", "GitHub"],
    skills: ["collect", "summarize"],
  },
  {
    key: "content-drafter",
    name: "Content Drafter",
    category: "Marketing",
    persona: "Drafts social posts from your docs and queues them for review.",
    recommendedAutonomy: "propose",
    thinkingLevel: "medium",
    connectors: ["Notion", "LinkedIn"],
    skills: ["draft"],
  },
];

export const TEMPLATE_CATEGORIES: string[] = [...new Set(AGENT_TEMPLATES.map((t) => t.category))];

export function templateToAgent(tenantId: string, template: AgentTemplate): Agent {
  return {
    id: newAgentId(),
    tenantId,
    key: `${template.key}-${newAgentId().slice(0, 4)}`,
    name: template.name,
    persona: template.persona,
    backend: "claude-agent-sdk",
    model: "claude-sonnet-4-6", // tier default — the Model Router governs this in prod
    thinkingLevel: template.thinkingLevel,
    autonomy: "propose", // new agents start in propose; promote from the control surface
    knowledgeScope: { folders: [], tags: [] },
    budgetCapUsd: 25,
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: template.key,
    projectIds: [],
    tags: [template.category.toLowerCase()],
    skillKeys: template.skills,
    mcpKeys: template.connectors,
  };
}

// A blank agent for the "start from scratch" path.
export function blankAgent(tenantId: string, name: string): Agent {
  return {
    id: newAgentId(),
    tenantId,
    key: `custom-${newAgentId().slice(0, 6)}`,
    name: name.trim() || "New agent",
    persona: null,
    backend: "claude-agent-sdk",
    model: "claude-sonnet-4-6",
    thinkingLevel: "medium",
    autonomy: "propose",
    knowledgeScope: { folders: [], tags: [] },
    budgetCapUsd: 25,
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
    projectIds: [],
    tags: [],
    skillKeys: [],
    mcpKeys: [],
  };
}
