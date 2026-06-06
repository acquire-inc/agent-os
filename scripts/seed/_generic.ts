// scripts/seed/_generic.ts
// Generic, doctrine-driven agent seeder. Given a roster spec {key, doc, tier},
// it pulls the VERBATIM system prompt + behavior fields from the doctrine (_doctrine.ts),
// resolves the model from the §1.5 tier (precedence: main wins), authors the agent's
// ONE primary function skill from its own workflow if missing (§3.2), and seeds the
// registry rows via the proven shared helpers. Idempotent.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Db,
  modelForAgent,
  ensureSkillFromDir,
  findMcpByName,
  upsertAgent,
  upsertCurrentPrompt,
  upsertCronTrigger,
  upsertTypedTrigger,
  projectCronTriggerToJob,
  setSkills,
  setMcps,
  summarizeAgent,
} from "./_shared.js";
import {
  getAgentBlock,
  parseAutonomy,
  parseBudget,
  parseTriggers,
  parseMcpKeys,
  parseSkillKeys,
  parseKnowledgeScope,
  parseApprovalGate,
} from "./_doctrine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, "..", "..", "external", "acqu-skills");

// Tier drives thinking effort, roster grouping, AND (since 2026-06) the per-task model routing.
export type { Tier } from "./_shared.js";
import type { Tier } from "./_shared.js";

const THINKING: Record<Tier, "low" | "medium" | "high"> = {
  "T-cheap": "low",
  "T-reason": "high",
  "T-work": "medium",
  "T-critical": "high",
};

/** Doctrine MCP key → seeded MCP name (tenant Acqu). Keys not here, or not seeded for
 *  Acqu (e.g. github lives under Cliently; pagerduty/resend aren't seeded), are skipped. */
const MCP_MAP: Record<string, string> = {
  "pipeboard-meta": "Pipeboard × Meta",
  pipeboard: "Pipeboard × Meta",
  close: "Close",
  slack: "Slack",
  gdrive: "Google Drive",
  gmail: "Gmail",
  calendar: "Google Calendar",
  "google-calendar": "Google Calendar",
  stripe: "Stripe",
  twilio: "Twilio",
  quickbooks: "QuickBooks",
  notion: "Notion",
  apollo: "Apollo",
  intercom: "Intercom",
  airtable: "Airtable",
  hubspot: "HubSpot",
  telegram: "Telegram",
  n8n: "n8n",
  fireflies: "Fireflies",
  pgvector: "pgvector Knowledge",
  "pgvector-knowledge": "pgvector Knowledge",
  github: "GitHub",
  linear: "Linear",
  sentry: "Sentry",
  vercel: "Vercel",
};

export type AgentSpec = {
  key: string;
  doc: "v1" | "v2";
  tier: Tier;
  /** Skill keys known to already have a SKILL.md (so we bind them too, not just the primary). */
  extraSkills?: string[];
};

export type SeedReport = {
  key: string;
  model: string;
  autonomy: string;
  budget: string;
  triggers: string;
  skills: string[];
  mcps: string[];
  authoredSkill: string | null;
  skippedMcps: string[];
  defaultedTriggers: string[];
};

function titleCase(key: string) {
  return key.replace(/[.-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Author a primary function skill's SKILL.md from the agent's own doctrine block — faithful
 *  (description from Job, body = the verbatim workflow + rules). No-op if it already exists. */
async function authorPrimarySkill(skillKey: string, block: ReturnType<typeof getAgentBlock>): Promise<boolean> {
  const path = join(SKILLS_DIR, skillKey, "SKILL.md");
  try {
    await readFile(path, "utf8");
    return false; // already authored — never overwrite (deliberate skills win)
  } catch {
    /* author below */
  }
  const job = (block.fields["Job"] ?? "").replace(/\s+/g, " ").trim();
  const trig = (block.fields["Trigger"] ?? "").replace(/\s+/g, " ").trim();
  const desc = `${job}${job && !job.endsWith(".") ? "." : ""}${trig ? ` Activates: ${trig}` : ""}`.slice(0, 280);
  const body = block.systemPrompt ?? job;
  const md = `---
name: ${skillKey}
description: ${desc.replace(/\n/g, " ")}
---
# ${titleCase(skillKey)}

> Authored from the \`${block.key}\` doctrine block (verbatim workflow). The senior's
> playbook for this function; \`skill-librarian\` refines it as patterns recur.

${body}
`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, md, "utf8");
  return true;
}

/** Seed one agent entirely from its doctrine block + tier. Returns a report row. */
export async function seedAgentFromSpec(db: Db, spec: AgentSpec): Promise<SeedReport> {
  const block = getAgentBlock(spec.doc, spec.key);
  if (!block.systemPrompt) {
    throw new Error(`No verbatim System prompt for "${spec.key}" in ${spec.doc} — refusing to seed without a doctrine prompt.`);
  }
  const model = modelForAgent(spec.key, spec.tier); // per-task model routing (2026-06)
  const autonomy = parseAutonomy(block.fields["Autonomy"]);
  const budget = parseBudget(block.fields["Budget"]);
  const { triggers, defaulted } = parseTriggers(block.fields["Trigger"], spec.key);
  const knowledgeScope = parseKnowledgeScope(block.fields["Knowledge scope"]);
  const escalationPolicy = parseApprovalGate(block.fields["Approval gate"]);

  // ── Agent row (persona mirrors the verbatim prompt) ──
  const agent = await upsertAgent(db, spec.key, {
    name: titleCase(spec.key),
    persona: block.systemPrompt,
    backend: "claude-agent-sdk",
    model,
    thinkingLevel: THINKING[spec.tier],
    autonomy,
    knowledgeScopeJson: knowledgeScope,
    budgetCapUsd: budget,
    escalationPolicy,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, block.systemPrompt);

  // ── Triggers (+ project cron into jobs for back-compat) ──
  for (const t of triggers) {
    if (t.type === "cron") {
      await upsertCronTrigger(db, agent.id, t.schedule);
      await projectCronTriggerToJob(db, agent.id, t.schedule, t.jobName);
    } else {
      await upsertTypedTrigger(db, agent.id, t.type, t.eventKey);
    }
  }

  // ── Skills: verification (always) + clarify (action-takers) + ONE primary function skill (§3.2) ──
  const skillIds: string[] = [];
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  skillIds.push(skVerify.id);
  if (autonomy === "propose") {
    const skClarify = await ensureSkillFromDir(db, { key: "clarify-before-acting", name: "Clarify Before Acting" });
    skillIds.push(skClarify.id);
  }
  let authoredSkill: string | null = null;
  const primary = parseSkillKeys(block.fields["Skills"])[0];
  if (primary) {
    const wasAuthored = await authorPrimarySkill(primary, block);
    if (wasAuthored) authoredSkill = primary;
    const sk = await ensureSkillFromDir(db, { key: primary, name: titleCase(primary) });
    if (!skillIds.includes(sk.id)) skillIds.push(sk.id);
  }
  // Any extra skills the caller knows already exist.
  for (const extra of spec.extraSkills ?? []) {
    const sk = await ensureSkillFromDir(db, { key: extra, name: titleCase(extra) });
    if (!skillIds.includes(sk.id)) skillIds.push(sk.id);
  }
  await setSkills(db, agent.id, skillIds);

  // ── MCPs: map doctrine keys → seeded names, skip unknown/unseeded ──
  const mcpIds: string[] = [];
  const skippedMcps: string[] = [];
  for (const k of parseMcpKeys(block.fields["MCPs"])) {
    const name = MCP_MAP[k];
    if (!name) { skippedMcps.push(k); continue; }
    try {
      const m = await findMcpByName(db, name);
      if (!mcpIds.includes(m.id)) mcpIds.push(m.id);
    } catch {
      skippedMcps.push(`${k}(not seeded for Acqu)`);
    }
  }
  await setMcps(db, agent.id, mcpIds);

  const s = await summarizeAgent(db, agent.id);
  return {
    key: spec.key,
    model: s.agent.model!,
    autonomy: s.agent.autonomy!,
    budget: String(s.agent.budgetCapUsd),
    triggers: s.triggers.map((t) => (t.type === "cron" ? `cron(${t.schedule})` : t.eventKey ? `${t.type}(${t.eventKey})` : t.type)).join(", "),
    skills: s.skills,
    mcps: s.mcps,
    authoredSkill,
    skippedMcps,
    defaultedTriggers: defaulted,
  };
}

/** Run a roster slice, print a per-agent table + tier check, return reports. */
export async function seedRoster(db: Db, roster: AgentSpec[], label: string): Promise<SeedReport[]> {
  console.log(`▸ Seeding ${label} (${roster.length} agents)…\n`);
  const reports: SeedReport[] = [];
  for (const spec of roster) {
    const r = await seedAgentFromSpec(db, spec);
    reports.push(r);
    const note = [r.authoredSkill ? `+skill:${r.authoredSkill}` : "", r.skippedMcps.length ? `skipMCP:${r.skippedMcps.join("/")}` : ""].filter(Boolean).join(" ");
    console.log(`  ✓ ${r.key.padEnd(26)} ${r.model.padEnd(30)} ${r.autonomy.padEnd(13)} $${r.budget.padEnd(5)} ${note}`);
  }
  return reports;
}
