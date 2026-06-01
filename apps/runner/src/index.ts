// The Runner: a pull-based worker. It polls the Agent API for each agent it
// owns, claims work, builds + executes a Claude Agent SDK run, streams activity,
// and posts the terminal status + cost. NAT-friendly — the control plane never
// reaches into the runner.
import { ApiClient } from "./api-client.js";
import { loadConfig, type RunnerConfig } from "./config.js";
import { executeRun } from "./execute.js";

async function pollAgent(api: ApiClient, cfg: RunnerConfig, agentId: string) {
  const res = await api.next(agentId);
  if (!res.hasWork || !res.run || !res.bundle) return false;

  const runId = res.run.id;
  console.log(`[runner] claimed run ${runId} for agent ${res.bundle.agent.key}`);
  const result = await executeRun(api, res.bundle, cfg);

  await api.putStatus(runId, {
    status: result.status,
    summary: result.summary,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
    sdkSessionId: result.sdkSessionId,
  });
  console.log(`[runner] run ${runId} → ${result.status} ($${result.costUsd.toFixed(4)})`);
  return true;
}

async function tick(api: ApiClient, cfg: RunnerConfig) {
  for (const agentId of cfg.agentIds) {
    try {
      // Drain all queued work for this agent each tick.
      while (await pollAgent(api, cfg, agentId)) {
        /* keep draining */
      }
    } catch (err) {
      console.error(`[runner] poll error for ${agentId}:`, err instanceof Error ? err.message : err);
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the configured RUNNER_AGENT_IDS (which may be UUIDs, agent keys, or "all") into the
 *  concrete agent UUIDs to poll. Keys/"all" are looked up via the API (tenant-scoped). */
async function resolveAgentIds(api: ApiClient, configured: string[]): Promise<string[]> {
  const wantAll = configured.some((s) => s.toLowerCase() === "all");
  const uuids = configured.filter((s) => UUID_RE.test(s));
  const keys = configured.filter((s) => !UUID_RE.test(s) && s.toLowerCase() !== "all");
  if (!wantAll && keys.length === 0) return uuids; // pure-UUID config: no lookup needed

  const agents = await api.listAgents();
  const byKey = new Map(agents.map((a) => [a.key, a]));
  const resolved = new Set(uuids);
  if (wantAll) for (const a of agents) if (a.enabled) resolved.add(a.id);
  for (const k of keys) {
    const a = byKey.get(k);
    if (a) resolved.add(a.id);
    else console.warn(`[runner] agent key "${k}" not found for this tenant — skipping.`);
  }
  return [...resolved];
}

async function main() {
  const cfg = loadConfig();
  const api = new ApiClient(cfg);

  // Resolve keys/"all" → UUIDs so operators can use RUNNER_AGENT_IDS="vitals,ad-ops" or "all"
  // instead of hand-looking-up UUIDs.
  cfg.agentIds = await resolveAgentIds(api, cfg.agentIds);
  if (cfg.agentIds.length === 0) throw new Error("RUNNER_AGENT_IDS resolved to zero agents (check keys / tenant).");

  console.log(
    `[runner] ${cfg.runnerId} polling ${cfg.agentIds.length} agent(s) at ${cfg.apiUrl} ` +
      `(${cfg.dryRun ? "DRY-RUN — no ANTHROPIC_API_KEY" : "live Agent SDK"})`,
  );

  if (cfg.once) {
    await tick(api, cfg);
    console.log("[runner] one-shot complete.");
    process.exit(0);
  }

  await tick(api, cfg);
  setInterval(() => void tick(api, cfg), cfg.pollIntervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
