// Composes the system + user prompts the LLM sees when architecting a team.

import type { ArchitectInput } from "./types.js";

export interface TenantContext {
  tenantName: string;
  existingAgents: { key: string; name: string; role: string }[];
  connectedMcps: { name: string; status: string }[];
  availableSkills: { key: string; name: string }[];
}

/** Hard rules the LLM must obey. Kept short because long rules confuse models. */
const HARD_RULES = `RULES (HARD — non-negotiable):
- Every NEW agent autonomy MUST be "propose". (Operator promotes after eval.)
- Never select model in the "can't-fail" tier (Opus-class / Sonnet-class reserved): ad-claim-compliance, tenant-isolation-tester, security-anomaly-watchdog, access-auditor, contract-drafter, contract-lifecycle-manager, pricing-architect, discount-governor, decision-memo-drafter, offer-architect, offer-validator, reinvestment-advisor, risk-register-keeper. If the request asks for one of these, return zero agents and a routing warning in rationale.
- Stagger cron schedules within a team by at least 5 minutes.
- Reuse existing tenant skills and MCPs when possible. List any required-but-missing skill in proposedSkills, missing MCP in proposedMcps.
- Default budgets: monitors $0.10, synthesizers $0.50, orchestrators $1.00, action agents ≤ $1.50.
- System prompt shape: "You are the X. You replace Y. EVERY <trigger>: numbered steps. RULES: hard constraints." Keep it under 25 lines.`;

const MODEL_TIERS = `MODEL TIERS (pick the cheapest that fits):
- T-cheap (monitors/watchers/triage/classifiers):       nousresearch/hermes-4-70b
- T-reason (synthesis/ranking/heavy analysis):          nousresearch/hermes-4-405b
- T-work-lite (multi-step orchestration, light):        anthropic/claude-haiku-4-5
- T-work (multi-step orchestration, client-facing):    anthropic/claude-sonnet-4.6
- T-critical (forbidden to architect, never assign here)`;

const OUTPUT_SCHEMA = `OUTPUT (strict JSON, no prose around it):
{
  "teamName": string,
  "rationale": string,           // 1-3 sentences: why this composition
  "agents": [
    {
      "key": "kebab-case-unique",
      "name": "Title Case",
      "role": "one-liner what they do",
      "systemPrompt": string,
      "model": "openrouter/slug",
      "thinkingLevel": "low" | "medium" | "high",
      "autonomy": "propose",
      "knowledgeScope": { "folders": string[], "tags": string[] },
      "budgetCapUsd": "0.30",     // string, 2 decimals
      "cron": { "schedule": "cron string", "jobName": "Title Case" } | null,
      "skillKeys": ["skill-key", ...],
      "mcpNames": ["MCP Name", ...]
    }
  ],
  "proposedSkills": [{"key":"...","name":"...","why":"..."}],
  "proposedMcps":   [{"name":"...","why":"..."}]
}`;

export function buildSystemPrompt(ctx: TenantContext): string {
  const existing = ctx.existingAgents.length
    ? ctx.existingAgents.map((a) => `  - ${a.key} (${a.name}) — ${a.role}`).join("\n")
    : "  (none — clean tenant)";

  const mcps = ctx.connectedMcps.length
    ? ctx.connectedMcps.map((m) => `  - "${m.name}" (${m.status})`).join("\n")
    : "  (none)";

  const skills = ctx.availableSkills.length
    ? ctx.availableSkills.map((s) => `  - ${s.key} (${s.name})`).join("\n")
    : "  (none)";

  return `You are the Agent Architect for ${ctx.tenantName}. You compose a team of agents that fit a coherent workflow — not a list of bullets. Output a single JSON object matching the schema below.

EXISTING AGENTS (do NOT duplicate any of these — extend/complement instead):
${existing}

CONNECTED MCPs (you may ONLY reference these in mcpNames; list anything else in proposedMcps):
${mcps}

AVAILABLE SKILLS (reuse where possible; list new ones in proposedSkills):
${skills}

${MODEL_TIERS}

${HARD_RULES}

${OUTPUT_SCHEMA}`;
}

export function buildUserPrompt(input: ArchitectInput): string {
  if (input.mode === "remix" && input.baseAgentKey) {
    return `REMIX request — modify the existing agent "${input.baseAgentKey}" per the instruction below. Return a single-agent team (one element in agents[]). Keep the existing key.\n\nInstruction:\n${input.prompt}`;
  }
  if (input.mode === "single") {
    return `SINGLE-AGENT request — create exactly ONE new agent. Return a one-agent team.\n\nRequest:\n${input.prompt}`;
  }
  return `TEAM request — compose the coherent team this requires.\n\nRequest:\n${input.prompt}`;
}
