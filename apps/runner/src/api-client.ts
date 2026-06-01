import type { RunnerConfig } from "./config.js";

export interface NextResponse {
  hasWork: boolean;
  run?: { id: string; agentId: string; status: string; sdkSessionId: string | null };
  bundle?: Bundle;
}

export interface Bundle {
  run: { id: string; status: string; triggerSource: string; scheduledFor: string | null; sdkSessionId: string | null };
  job: { name: string; instructions: string; scheduleCron: string } | null;
  agent: {
    key: string; name: string; persona: string | null; backend: string; model: string;
    thinkingLevel: string; autonomy: string; escalationPolicy: string | null; budgetCapUsd: number | null; runnerKind: string;
  };
  skills: { key: string; name: string; description: string }[];
  tools: { key: string; name: string; description: string; kind: string; requiresApproval: boolean; reversible: boolean }[];
  mcpServers: { name: string; transport: string; endpoint: string | null; authType: string; credentials: { vaultRef?: string; token?: string; ttlSeconds: number } | null }[];
  knowledge: { chunk: string; source: string }[];
  recentSummaries?: { status: string; whatIDid: string; whatILearned: string; whatNext: string; createdAt: string }[];
  envVars: Record<string, string>;
  autonomy: string;
  api: { statusUrl: string; activityUrl: string; approvalsUrl: string; validStatuses: string[] };
}

export class ApiClient {
  constructor(private cfg: RunnerConfig) {}

  private headers() {
    return { Authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json", "x-runner-id": this.cfg.runnerId };
  }

  async next(agentId: string): Promise<NextResponse> {
    const res = await fetch(`${this.cfg.apiUrl}/api/agents/${agentId}/next`, { headers: this.headers() });
    if (!res.ok) throw new Error(`next ${agentId}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<NextResponse>;
  }

  /** List the tenant's agents (for resolving keys/"all" → UUIDs at startup). */
  async listAgents(): Promise<{ id: string; key: string; status: string; enabled: boolean }[]> {
    const res = await fetch(`${this.cfg.apiUrl}/api/agents`, { headers: this.headers() });
    if (!res.ok) throw new Error(`listAgents: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { agents: { id: string; key: string; status: string; enabled: boolean }[] }).agents;
  }

  async postActivity(runId: string, kind: string, message: string): Promise<void> {
    await fetch(`${this.cfg.apiUrl}/api/runs/${runId}/activity`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ kind, message }),
    });
  }

  async putStatus(
    runId: string,
    body: { status: string; summary?: string; tokensIn?: number; tokensOut?: number; costUsd?: number; sdkSessionId?: string },
  ): Promise<void> {
    const res = await fetch(`${this.cfg.apiUrl}/api/runs/${runId}/status`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`status ${runId}: ${res.status} ${await res.text()}`);
  }

  async postApproval(runId: string, body: { context: string; proposedAction: string; options: { key: string; label: string }[]; sdkSessionId?: string }): Promise<void> {
    await fetch(`${this.cfg.apiUrl}/api/runs/${runId}/approvals`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
  }

  /** PostToolUse hook target — immutable audit trail of tool calls. */
  async postAudit(runId: string, body: { toolName: string; inputHash?: string; result?: string }): Promise<void> {
    await fetch(`${this.cfg.apiUrl}/api/runs/${runId}/audit`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  /** Autonomy gate decision record (allow/propose/deny/escalate/stop/budget_cap/session_end). */
  async postAutonomyEvent(runId: string, body: { kind: string; toolName?: string; rationale?: string }): Promise<void> {
    await fetch(`${this.cfg.apiUrl}/api/runs/${runId}/autonomy-event`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    }).catch(() => {});
  }
}
