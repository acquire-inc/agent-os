// scripts/seed/export-agents.ts
// v3 enhancement A — SDK-native agent export. Renders every registry agent as a Claude Agent
// SDK subagent file (`exports/agents/<key>.md` with name/description/model/tools frontmatter +
// the system prompt body) plus a `exports/managed-agents-registry.json` manifest — the exact
// shape the uploaded agentic-templates repo uses. Makes our DB agents portable to the Agent
// SDK / Managed Agents runtime, human-diffable, and deployable. Files are GENERATED from the
// registry (the source of truth is the doctrine → DB; edit there and re-export).

import { createDb, schema } from "@agent-os/db";
import { and, eq } from "drizzle-orm";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO_ROOT, TENANT_ID } from "./_shared.js";

const OUT_DIR = join(REPO_ROOT, "exports", "agents");
const MANIFEST = join(REPO_ROOT, "exports", "managed-agents-registry.json");

/** One-line, YAML-safe description (frontmatter scalar). */
function oneLine(s: string | null, fallback: string): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim() || fallback;
  const clipped = t.length > 200 ? t.slice(0, 197) + "…" : t;
  return clipped.replace(/"/g, "'");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);

  const agents = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, TENANT_ID));
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const manifest: Record<string, unknown>[] = [];
  let written = 0;

  for (const a of agents.sort((x, y) => x.key.localeCompare(y.key))) {
    // Current prompt.
    const [prompt] = await db.select().from(schema.agentPrompts)
      .where(and(eq(schema.agentPrompts.agentId, a.id), eq(schema.agentPrompts.isCurrent, true)));
    const body = prompt?.systemPrompt ?? a.persona ?? `You are ${a.name}.`;

    // Bound tools / skills / mcps / triggers.
    const tools = (await db.execute(
      `select t.tool_key from agent_tools l join tools t on t.id=l.tool_id where l.agent_id='${a.id}' order by t.tool_key`,
    )) as unknown as { tool_key: string }[];
    const skills = (await db.execute(
      `select s.key from agent_skills l join skills s on s.id=l.skill_id where l.agent_id='${a.id}' order by s.key`,
    )) as unknown as { key: string }[];
    const mcps = (await db.execute(
      `select m.name from agent_mcps l join mcps m on m.id=l.mcp_id where l.agent_id='${a.id}' order by m.name`,
    )) as unknown as { name: string }[];
    const triggers = await db.select().from(schema.agentTriggers).where(eq(schema.agentTriggers.agentId, a.id));

    const toolKeys = tools.map((t) => t.tool_key);
    const trigSummary = triggers
      .map((t) => (t.type === "cron" ? `cron(${t.schedule})` : t.eventKey ? `${t.type}(${t.eventKey})` : t.type))
      .join(", ");

    const fm = [
      "---",
      `name: ${a.key}`,
      `description: "${oneLine(a.persona, a.name)}"`,
      `model: ${a.model}`,
      toolKeys.length ? `tools: [${toolKeys.join(", ")}]` : "tools: []",
      "---",
    ].join("\n");

    const opsConfig = [
      "",
      "<!-- GENERATED from the agent-os registry by export-agents.ts — do not edit by hand;",
      "     edit the doctrine, re-seed, and re-export. -->",
      "",
      "## Operating config (agent-os registry)",
      `- autonomy: ${a.autonomy}`,
      `- backend: ${a.backend}`,
      `- thinking_level: ${a.thinkingLevel}`,
      `- budget_cap_usd: ${a.budgetCapUsd ?? "n/a"}`,
      a.escalationPolicy ? `- escalation: ${oneLine(a.escalationPolicy, "")}` : null,
      skills.length ? `- skills: ${skills.map((s) => s.key).join(", ")}` : null,
      mcps.length ? `- mcps: ${mcps.map((m) => m.name).join(", ")}` : null,
      trigSummary ? `- triggers: ${trigSummary}` : null,
    ].filter(Boolean).join("\n");

    await writeFile(join(OUT_DIR, `${a.key}.md`), `${fm}\n\n${body}\n${opsConfig}\n`, "utf8");
    written++;

    manifest.push({
      id: a.key,
      version: prompt?.version ?? "0.1.0",
      name: a.name,
      model: a.model,
      filename: `agents/${a.key}.md`,
      status: a.enabled ? "active" : "planned",
      autonomy: a.autonomy,
      tools: toolKeys.length,
      system_prompt_length: body.length,
    });
  }

  await writeFile(
    MANIFEST,
    JSON.stringify({
      _generated_by: "scripts/seed/export-agents.ts",
      _source: "agent-os registry (doctrine → DB)",
      tenant: "acqu",
      count: manifest.length,
      deployment_order: manifest.map((m) => m.id),
      agents: manifest,
    }, null, 2) + "\n",
    "utf8",
  );

  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("SDK-NATIVE AGENT EXPORT");
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(`  Subagent files written: ${written}  → exports/agents/<key>.md`);
  console.log(`  Manifest:               exports/managed-agents-registry.json (${manifest.length} agents)`);
  const active = manifest.filter((m) => m.status === "active").length;
  console.log(`  active: ${active}  |  planned: ${manifest.length - active}`);
  console.log("\n✓ Export complete.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
