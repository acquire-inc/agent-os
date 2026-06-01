export interface RunnerConfig {
  apiUrl: string;
  apiKey: string;
  agentIds: string[];
  runnerId: string;
  pollIntervalMs: number;
  once: boolean;
  anthropicKey: string | undefined;
  /** When true (no Anthropic key), simulate runs so the full loop is exercisable. */
  dryRun: boolean;
}

export function loadConfig(): RunnerConfig {
  const apiUrl = process.env.API_URL ?? "http://localhost:8787";
  const apiKey = process.env.RUNNER_API_KEY ?? "";
  if (!apiKey) throw new Error("RUNNER_API_KEY is required");
  // Accepts UUIDs, agent keys (e.g. "vitals,ad-ops"), or "all" — resolved at runner startup.
  const agentIds = (process.env.RUNNER_AGENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (agentIds.length === 0) throw new Error("RUNNER_AGENT_IDS is required (UUIDs, agent keys, or 'all')");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  return {
    apiUrl,
    apiKey,
    agentIds,
    runnerId: process.env.RUNNER_ID ?? `runner-${process.pid}`,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 60_000),
    once: process.env.RUNNER_ONCE === "1",
    anthropicKey,
    dryRun: !anthropicKey || process.env.RUNNER_DRY_RUN === "1",
  };
}
