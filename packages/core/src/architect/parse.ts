// Parse + validate the LLM's JSON output into a TeamBlueprintProposal.
// Tolerates ```json fences and stray text around the JSON body.

import type { AgentBlueprint, TeamBlueprintProposal } from "./types.js";

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CRON_RE = /^(\S+\s+){4}\S+$/;
const ALLOWED_AUTONOMY = new Set(["propose", "execute_safe"]);
const ALLOWED_THINKING = new Set(["low", "medium", "high"]);

/** Strip ```json fences and find the outermost {...} body. */
export function extractJsonBody(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  const candidate = fenced ? fenced[1] ?? trimmed : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new ParseError("no JSON object found in LLM output");
  }
  return candidate.slice(start, end + 1);
}

export class ParseError extends Error {}

interface RawAgent {
  key?: unknown;
  name?: unknown;
  role?: unknown;
  systemPrompt?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  autonomy?: unknown;
  knowledgeScope?: unknown;
  budgetCapUsd?: unknown;
  cron?: unknown;
  skillKeys?: unknown;
  mcpNames?: unknown;
}

export function parseTeamProposal(raw: string): TeamBlueprintProposal {
  const body = extractJsonBody(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new ParseError(`invalid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") throw new ParseError("top-level must be an object");
  const obj = parsed as Record<string, unknown>;

  const teamName = expectString(obj.teamName, "teamName");
  const rationale = expectString(obj.rationale, "rationale");
  const agentsRaw = obj.agents;
  if (!Array.isArray(agentsRaw)) throw new ParseError("agents must be an array");

  const agents = agentsRaw.map((a, i) => parseAgent(a as RawAgent, i));

  // Cross-agent validation: unique keys, staggered crons.
  const seenKeys = new Set<string>();
  for (const a of agents) {
    if (seenKeys.has(a.key)) throw new ParseError(`duplicate key "${a.key}"`);
    seenKeys.add(a.key);
  }

  const proposedSkills = parsePropList(obj.proposedSkills, "proposedSkills", ["key", "name"]) as {
    key: string;
    name: string;
    why: string;
  }[];
  const proposedMcps = parsePropList(obj.proposedMcps, "proposedMcps", ["name"]) as {
    name: string;
    why: string;
  }[];

  return { teamName, rationale, agents, proposedSkills, proposedMcps };
}

function parseAgent(a: RawAgent, idx: number): AgentBlueprint {
  const where = `agents[${idx}]`;
  const key = expectString(a.key, `${where}.key`);
  if (!KEY_RE.test(key)) throw new ParseError(`${where}.key "${key}" must be kebab-case`);
  const autonomy = expectString(a.autonomy, `${where}.autonomy`);
  if (!ALLOWED_AUTONOMY.has(autonomy))
    throw new ParseError(`${where}.autonomy must be "propose" or "execute_safe"`);
  const thinkingLevel = a.thinkingLevel == null ? "low" : expectString(a.thinkingLevel, `${where}.thinkingLevel`);
  if (!ALLOWED_THINKING.has(thinkingLevel))
    throw new ParseError(`${where}.thinkingLevel must be low|medium|high`);

  const ks = a.knowledgeScope as { folders?: unknown; tags?: unknown } | undefined;
  const folders = Array.isArray(ks?.folders) ? ks!.folders.map(String) : [];
  const tags = Array.isArray(ks?.tags) ? ks!.tags.map(String) : [];

  const budget = expectString(a.budgetCapUsd, `${where}.budgetCapUsd`);
  if (!/^\d+(\.\d{1,2})?$/.test(budget))
    throw new ParseError(`${where}.budgetCapUsd "${budget}" must be a numeric string`);

  let cron: AgentBlueprint["cron"] = null;
  if (a.cron != null) {
    const cr = a.cron as { schedule?: unknown; jobName?: unknown };
    const schedule = expectString(cr.schedule, `${where}.cron.schedule`);
    if (!CRON_RE.test(schedule))
      throw new ParseError(`${where}.cron.schedule "${schedule}" not a 5-field cron string`);
    cron = { schedule, jobName: expectString(cr.jobName, `${where}.cron.jobName`) };
  }

  return {
    key,
    name: expectString(a.name, `${where}.name`),
    role: expectString(a.role, `${where}.role`),
    systemPrompt: expectString(a.systemPrompt, `${where}.systemPrompt`),
    model: expectString(a.model, `${where}.model`),
    thinkingLevel: thinkingLevel as "low" | "medium" | "high",
    autonomy: autonomy as "propose" | "execute_safe",
    knowledgeScope: { folders, tags },
    budgetCapUsd: budget,
    cron,
    skillKeys: Array.isArray(a.skillKeys) ? a.skillKeys.map(String) : [],
    mcpNames: Array.isArray(a.mcpNames) ? a.mcpNames.map(String) : [],
  };
}

function expectString(v: unknown, where: string): string {
  if (typeof v !== "string" || !v) throw new ParseError(`${where} required, got ${typeof v}`);
  return v;
}

function parsePropList(v: unknown, where: string, required: string[]): unknown[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new ParseError(`${where} must be an array if present`);
  return v.map((item, i) => {
    const obj = item as Record<string, unknown>;
    for (const k of required) {
      if (typeof obj[k] !== "string" || !obj[k])
        throw new ParseError(`${where}[${i}].${k} required`);
    }
    return { ...obj, why: typeof obj.why === "string" ? obj.why : "" };
  });
}
