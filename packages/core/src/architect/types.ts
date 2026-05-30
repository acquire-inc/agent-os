// Architect feature — the meta-agent that turns a plain-English prompt
// into one or more AgentSpec rows, idempotently seeded via seedAgent.
//
// Spec: docs/specs/agent-architect.md

import type { AgentSpec } from "../seed/seedAgent.js";

export type ArchitectMode = "team" | "remix" | "single";

export interface ArchitectInput {
  /** The natural-language request. */
  prompt: string;
  /** Tenant that owns the resulting agents. */
  tenantId: string;
  /** Operator user id, for audit. */
  userId?: string | null;
  /** "remix" mode requires the base agent's key to anchor edits. */
  mode?: ArchitectMode;
  baseAgentKey?: string;
  /** Optional max cost cap on the architect's own LLM call (USD). Defaults to 0.20. */
  llmBudgetUsd?: number;
}

/** What the LLM emits, before MCP/skill resolution. */
export interface AgentBlueprint {
  key: string;
  name: string;
  role: string;
  systemPrompt: string;
  /** OpenRouter slug or short alias (architect rewrites short aliases via the tier table). */
  model: string;
  thinkingLevel?: "low" | "medium" | "high";
  /** Architect MAY only emit "propose" or "execute_safe"; execute_full is forbidden. */
  autonomy: "propose" | "execute_safe";
  knowledgeScope: { folders: string[]; tags: string[] };
  budgetCapUsd: string;
  cron?: { schedule: string; jobName: string } | null;
  /** Skill keys (referenced by key — architect doesn't author new skills). */
  skillKeys: string[];
  /** MCP names exactly as registered in the tenant's `mcps` table. */
  mcpNames: string[];
}

export interface TeamBlueprintProposal {
  teamName: string;
  rationale: string;
  agents: AgentBlueprint[];
  /** Skill keys the LLM thought it needed but which don't exist on the tenant. */
  proposedSkills: { key: string; name: string; why: string }[];
  /** MCP names the LLM thought it needed but which aren't registered/connected. */
  proposedMcps: { name: string; why: string }[];
}

export interface HydratedBlueprint {
  id: string;
  tenantId: string;
  prompt: string;
  teamName: string;
  rationale: string;
  /** AgentSpec[] ready to pass to seedAgent — autonomy clamped to "propose" for action agents,
   * enabled forced to `false` until first dry-run. */
  agents: AgentSpec[];
  warnings: string[];
  proposedSkills: { key: string; name: string; why: string }[];
  proposedMcps: { name: string; why: string }[];
  llmModel: string;
  llmCostUsd: number;
  status: "proposed" | "approved" | "seeded" | "rejected" | "superseded";
  createdAt: Date;
}

export interface SeedFromBlueprintResult {
  blueprintId: string;
  seeded: { key: string; agentId: string; autonomy: string; enabled: boolean }[];
}
