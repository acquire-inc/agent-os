// scripts/seed/acqu-connector-health-monitor.ts
// Seeds the `connector-health-monitor` agent for tenant Acqu — DATA ONLY, idempotent.
// Model: hermes-4-70b (T-cheap) — healthcheck, fires ~2,880×/month (70B carries volume).
// System prompt: VERBATIM from acqu-agent-doctrine-v2.md D5.2 → #### `connector-health-monitor`.

import { createDb } from "@agent-os/db";
import {
  modelForAgent,
  type Db,
  ensureSkillFromDir,
  findMcpByName,
  upsertAgent,
  upsertCurrentPrompt,
  upsertCronTrigger,
  projectCronTriggerToJob,
  setSkills,
  setMcps,
  summarizeAgent,
} from "./_shared.js";

// VERBATIM — acqu-agent-doctrine-v2.md D5.2, connector-health-monitor "System prompt:" block.
const CONNECTOR_HEALTH_SYSTEM_PROMPT = `You are the Connector Health Monitor. You replace an SRE watching integrations.
You exist because a dead connector breaks agents silently — ad-ops "succeeds" with stale data, and nobody notices for days.

EVERY 15 MIN:
1. Healthcheck every connector (tool.connector-healthcheck): auth valid? Responding? Latency normal? Error rate normal?
2. For any connector DOWN or DEGRADED:
   - Identify which agents depend on it (from kb:infra/connectors.md).
   - Signal those agents to HALT (don't run on bad data) rather than fail silently.
   - Slack #infra alert with: connector, status, dependent agents halted, likely cause (auth expiry vs. provider outage).
3. For auth EXPIRING soon (token TTL low): proactive alert to rotate (hand to D5.3 secrets-rotation).

RULES:
- Halting a dependent agent is better than letting it run on stale/broken data.
- Distinguish "our auth broke" (we fix) from "provider is down" (we wait + communicate).
- Auth expiry is preventable — never let it surprise you.`;

export async function seedConnectorHealthMonitor(db: Db) {
  const skVerify = await ensureSkillFromDir(db, { key: "verification-before-completion", name: "Verification Before Completion" });
  const skConnector = await ensureSkillFromDir(db, { key: "connector-health", name: "Connector Health" });

  const mcpSlack = await findMcpByName(db, "Slack");

  const agent = await upsertAgent(db, "connector-health-monitor", {
    name: "Connector Health Monitor",
    persona: CONNECTOR_HEALTH_SYSTEM_PROMPT,
    backend: "claude-agent-sdk",
    model: modelForAgent("connector-health-monitor", "T-cheap"),
    thinkingLevel: "low",
    autonomy: "execute_safe",
    knowledgeScopeJson: { folders: ["infra"], tags: ["acqu"] },
    budgetCapUsd: "0.05",
    escalationPolicy: null,
    runnerKind: "local",
    enabled: true,
    templateId: null,
  });

  await upsertCurrentPrompt(db, agent.id, CONNECTOR_HEALTH_SYSTEM_PROMPT);
  await upsertCronTrigger(db, agent.id, "*/15 * * * *");
  await projectCronTriggerToJob(db, agent.id, "*/15 * * * *", "Connector healthcheck");

  await setSkills(db, agent.id, [skVerify.id, skConnector.id]);
  await setMcps(db, agent.id, [mcpSlack.id]);

  return agent.id;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  console.log("▸ Seeding connector-health-monitor for tenant Acqu…");
  const id = await seedConnectorHealthMonitor(db);
  const s = await summarizeAgent(db, id);
  console.log(`✓ connector-health-monitor  model=${s.agent.model}  autonomy=${s.agent.autonomy}  budget=$${s.agent.budgetCapUsd}`);
  console.log(`  skills: ${s.skills.join(", ")}`);
  console.log(`  mcps:   ${s.mcps.join(", ")}`);
  console.log(`  triggers: ${JSON.stringify(s.triggers)}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
