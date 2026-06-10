// Client-side agent config overrides. Mirrors connector-store: in demo mode the
// app has no backend, so operator edits to an agent's control surface (autonomy,
// budget cap, thinking level, escalation policy, connector bindings, enabled)
// persist to localStorage and overlay the fixtures via data.agents(). In Supabase
// mode the same edits would PATCH the agents row — the UI never changes.
//
// Note: model/tier is deliberately NOT editable here. The Model Router governs it
// server-side (model is config, not per-agent UI state) and T-critical agents are
// pinned to Opus and exempt from overrides — so leaving it out keeps that
// invariant un-violable from the control surface.
import type { Agent } from "@agent-os/shared";

const KEY = "aos-agent-overrides";

export type AgentPatch = Partial<
  Pick<Agent, "enabled" | "autonomy" | "thinkingLevel" | "budgetCapUsd" | "escalationPolicy" | "mcpKeys">
>;

type ByTenant = Record<string, Record<string, AgentPatch>>;

function read(): ByTenant {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as ByTenant;
  } catch {
    return {};
  }
}

function write(value: ByTenant): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* non-fatal in demo */
  }
}

export function agentOverride(tenantId: string, id: string): AgentPatch | undefined {
  return read()[tenantId]?.[id];
}

// Merge (shallow) a patch onto any existing override for this agent.
export function setAgentOverride(tenantId: string, id: string, patch: AgentPatch): void {
  const all = read();
  const tenant = all[tenantId] ?? {};
  tenant[id] = { ...tenant[id], ...patch };
  all[tenantId] = tenant;
  write(all);
}

export function clearAgentOverride(tenantId: string, id: string): void {
  const all = read();
  if (all[tenantId]) {
    delete all[tenantId][id];
    write(all);
  }
}

// Apply stored overrides onto a base (fixture) agent list.
export function mergeAgents(tenantId: string, base: Agent[]): Agent[] {
  const overrides = read()[tenantId];
  if (!overrides) return base;
  return base.map((a) => (overrides[a.id] ? { ...a, ...overrides[a.id] } : a));
}
