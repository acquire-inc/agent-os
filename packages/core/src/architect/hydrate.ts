// Resolve a parsed TeamBlueprintProposal against the tenant's connected MCPs
// and skills. Annotates warnings for unknown names. Clamps autonomy + enabled
// to the safe defaults (architect can never bypass these).

import type { AgentSpec } from "../seed/seedAgent.js";
import { checkCraProhibition } from "./cra-blocklist.js";
import type { AgentBlueprint, TeamBlueprintProposal } from "./types.js";

export interface ResolverContext {
  /** Skills the tenant already has registered (keys are lowercase, unique per tenant). */
  knownSkillKeys: Set<string>;
  /** MCP names exactly as written in the `mcps` table for this tenant. */
  knownMcpNames: Set<string>;
}

export interface HydrationOutput {
  agents: AgentSpec[];
  warnings: string[];
}

// Per main §1.5 — the can't-fail agents that architect MUST refuse to assemble.
const CANT_FAIL_KEYS = new Set([
  "ad-claim-compliance",
  "tenant-isolation-tester",
  "security-anomaly-watchdog",
  "access-auditor",
  // Phase 9: secrets-rotation added per CLAUDE.md can't-fail list (pattern-mapper gap fix)
  "secrets-rotation",
  "contract-drafter",
  "contract-lifecycle-manager",
  "pricing-architect",
  "discount-governor",
  "decision-memo-drafter",
  "offer-architect",
  "offer-validator",
  "reinvestment-advisor",
  "risk-register-keeper",
]);

const MAX_BUDGET_USD = 2.0;

export function hydrate(
  tenantId: string,
  proposal: TeamBlueprintProposal,
  ctx: ResolverContext,
): HydrationOutput {
  const warnings: string[] = [];
  const agents: AgentSpec[] = [];

  // Cron stagger check (informational warning only — we don't reject).
  const minutes = proposal.agents
    .map((a) => a.cron?.schedule)
    .filter((s): s is string => Boolean(s))
    .map(cronStartMinute);
  for (let i = 0; i < minutes.length; i++) {
    for (let j = i + 1; j < minutes.length; j++) {
      const a = minutes[i];
      const b = minutes[j];
      if (a != null && b != null && Math.abs(a - b) < 5) {
        warnings.push(
          `cron stagger: agents ${proposal.agents[i]!.key} and ${proposal.agents[j]!.key} both start within 5 min of each other`,
        );
      }
    }
  }

  for (const blueprint of proposal.agents) {
    if (CANT_FAIL_KEYS.has(blueprint.key)) {
      warnings.push(
        `refusing to assemble can't-fail agent "${blueprint.key}" — must be authored by hand against the human can't-fail-agent flow`,
      );
      continue;
    }

    // CRA prohibition (CLAUDE.md HARD GATE). Check role + systemPrompt for
    // eligibility-decisioning language across credit / employment / housing /
    // insurance / government-benefit. Match -> skip blueprint, append warning.
    // The caller is responsible for emitting Relay event "architect.refused".
    const craText = `${blueprint.role ?? ""} ${blueprint.systemPrompt ?? ""}`;
    const cra = checkCraProhibition(craText);
    if (cra.prohibited && cra.category && cra.matchedKeyword) {
      warnings.push(
        `refusing CRA-prohibited blueprint "${blueprint.key}" — category=${cra.category} matched="${cra.matchedKeyword}". Global invariant; no per-tenant override.`,
      );
      continue;
    }

    const budgetNum = Number(blueprint.budgetCapUsd);
    if (Number.isFinite(budgetNum) && budgetNum > MAX_BUDGET_USD) {
      warnings.push(
        `agent "${blueprint.key}" budget $${blueprint.budgetCapUsd} clamped to $${MAX_BUDGET_USD.toFixed(2)}`,
      );
    }
    const clampedBudget = Number.isFinite(budgetNum)
      ? Math.min(budgetNum, MAX_BUDGET_USD).toFixed(2)
      : "0.50";

    // Resolve MCPs: keep known, drop unknown with a warning.
    const mcpNames: string[] = [];
    for (const name of blueprint.mcpNames) {
      if (ctx.knownMcpNames.has(name)) {
        mcpNames.push(name);
      } else {
        warnings.push(
          `agent "${blueprint.key}" references MCP "${name}" which is not connected on this tenant — binding skipped`,
        );
      }
    }

    // Resolve skills: keep known, register the rest as proposed (handled by caller via proposedSkills).
    const skills: { key: string; name: string }[] = [];
    for (const skillKey of blueprint.skillKeys) {
      if (ctx.knownSkillKeys.has(skillKey)) {
        skills.push({ key: skillKey, name: titleize(skillKey) });
      } else {
        warnings.push(
          `agent "${blueprint.key}" references skill "${skillKey}" which doesn't exist on this tenant — left unbound, see proposedSkills`,
        );
      }
    }

    agents.push({
      tenantId,
      key: blueprint.key,
      name: blueprint.name,
      systemPrompt: blueprint.systemPrompt,
      model: blueprint.model,
      thinkingLevel: blueprint.thinkingLevel ?? "low",
      // Hard floor: architect can never emit anything beyond "propose".
      autonomy: "propose",
      knowledgeScope: blueprint.knowledgeScope,
      budgetCapUsd: clampedBudget,
      cron: blueprint.cron ?? null,
      skills,
      mcpNames,
      // Disabled by default — operator flips on after first dry-run.
      enabled: false,
    });
  }

  return { agents, warnings };
}

function cronStartMinute(schedule: string): number | null {
  const minField = schedule.split(/\s+/)[0];
  if (!minField) return null;
  const n = Number(minField);
  return Number.isFinite(n) ? n : null;
}

function titleize(key: string): string {
  return key
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function isCantFail(key: string): boolean {
  return CANT_FAIL_KEYS.has(key);
}

/** Helper for callers building a ResolverContext from a blueprint's missing references. */
export function blueprintGaps(
  proposal: TeamBlueprintProposal,
  ctx: ResolverContext,
): { missingSkills: string[]; missingMcps: string[] } {
  const missingSkills = new Set<string>();
  const missingMcps = new Set<string>();
  for (const a of proposal.agents) {
    for (const k of a.skillKeys) if (!ctx.knownSkillKeys.has(k)) missingSkills.add(k);
    for (const n of a.mcpNames) if (!ctx.knownMcpNames.has(n)) missingMcps.add(n);
  }
  return { missingSkills: [...missingSkills], missingMcps: [...missingMcps] };
}

export type { AgentBlueprint };
