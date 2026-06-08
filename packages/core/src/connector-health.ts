// packages/core/src/connector-health.ts — the deterministic tool behind tool.connector-healthcheck,
// used by the connector-health-monitor agent (Wave-1). Pure: the runtime probes each connector's
// status (the bundle/vault already carries it); this evaluates and proposes the fix. The agent
// flags + PROPOSES reauth/escalation — it never silently drops a connector its agents depend on.

export type ConnectorStatus = "connected" | "needs_reauth" | "disconnected" | "error";

export interface ConnectorHealth {
  name: string;
  status: ConnectorStatus;
  /** how many enabled agents depend on this connector (drives priority). */
  dependents?: number;
}

export interface ConnectorAction {
  name: string;
  status: ConnectorStatus;
  action: "none" | "reauth" | "reconnect" | "investigate";
  dependents: number;
  severity: "ok" | "warn" | "critical";
}

export interface ConnectorHealthResult {
  allHealthy: boolean;
  actions: ConnectorAction[];   // every connector, worst-first
  needsAttention: ConnectorAction[];
  summary: string;
}

function actionFor(status: ConnectorStatus): ConnectorAction["action"] {
  return status === "connected" ? "none"
    : status === "needs_reauth" ? "reauth"
    : status === "disconnected" ? "reconnect"
    : "investigate";
}

/** Evaluate connector health → a prioritized action list. Pure. A connector that's down with
 *  dependents is critical (its agents can't work); down with none is a warning. */
export function evaluateConnectorHealth(connectors: ConnectorHealth[]): ConnectorHealthResult {
  const actions: ConnectorAction[] = connectors.map((c) => {
    const dependents = c.dependents ?? 0;
    const action = actionFor(c.status);
    const severity: ConnectorAction["severity"] =
      c.status === "connected" ? "ok" : dependents > 0 ? "critical" : "warn";
    return { name: c.name, status: c.status, action, dependents, severity };
  });
  const rank = { critical: 2, warn: 1, ok: 0 } as const;
  actions.sort((a, b) => rank[b.severity] - rank[a.severity] || b.dependents - a.dependents || a.name.localeCompare(b.name));
  const needsAttention = actions.filter((a) => a.action !== "none");
  const allHealthy = needsAttention.length === 0;
  const summary = allHealthy
    ? `All ${actions.length} connectors healthy.`
    : `${needsAttention.length} connector(s) need attention: ${needsAttention.map((a) => `${a.name}→${a.action}${a.dependents ? ` (${a.dependents} agents)` : ""}`).join(", ")}.`;
  return { allHealthy, actions, needsAttention, summary };
}
