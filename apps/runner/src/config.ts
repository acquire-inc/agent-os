export type RunnerAuthMode = "gateway" | "subscription" | "dry-run";

export interface RunnerConfig {
  apiUrl: string;
  apiKey: string;
  agentIds: string[];
  runnerId: string;
  pollIntervalMs: number;
  once: boolean;
  anthropicKey: string | undefined;
  /** How the Agent SDK authenticates:
   *  - "gateway": ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL=OpenRouter per
   *    doctrine) — the production path; serves EVERY tier incl. Hermes.
   *  - "subscription": CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`,
   *    billed to the operator's Claude Pro/Max subscription. INTERNAL USE
   *    ONLY (CLAUDE.md: customer-facing Cliently must use API-key auth).
   *    Serves CLAUDE models only — non-Claude tiers fail with a clear error.
   *  - "dry-run": neither credential; runs are simulated. */
  authMode: RunnerAuthMode;
  /** When true (no credential), simulate runs so the full loop is exercisable. */
  dryRun: boolean;
}

export function loadConfig(): RunnerConfig {
  const apiUrl = process.env.API_URL ?? "http://localhost:8787";
  const apiKey = process.env.RUNNER_API_KEY ?? "";
  if (!apiKey) throw new Error("RUNNER_API_KEY is required");
  const agentIds = (process.env.RUNNER_AGENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (agentIds.length === 0) throw new Error("RUNNER_AGENT_IDS (comma-separated) is required");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const forceDry = process.env.RUNNER_DRY_RUN === "1";
  let authMode: RunnerAuthMode = "dry-run";
  if (!forceDry && anthropicKey) authMode = "gateway";
  else if (!forceDry && oauthToken) authMode = "subscription";

  if (authMode === "subscription" && process.env.ANTHROPIC_BASE_URL) {
    // Subscription auth talks to Anthropic DIRECTLY. A gateway base URL
    // (OpenRouter) would send the OAuth token to a third party — strip it
    // from this process so the spawned Agent SDK never sees it.
    console.warn(
      "[runner] subscription auth: ignoring ANTHROPIC_BASE_URL (subscription talks to Anthropic directly; the gateway is for API-key mode)",
    );
    delete process.env.ANTHROPIC_BASE_URL;
  }

  return {
    apiUrl,
    apiKey,
    agentIds,
    runnerId: process.env.RUNNER_ID ?? `runner-${process.pid}`,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 60_000),
    once: process.env.RUNNER_ONCE === "1",
    anthropicKey,
    authMode,
    dryRun: authMode === "dry-run",
  };
}
