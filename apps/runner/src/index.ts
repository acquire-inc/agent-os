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

async function main() {
  const cfg = loadConfig();
  const api = new ApiClient(cfg);

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
