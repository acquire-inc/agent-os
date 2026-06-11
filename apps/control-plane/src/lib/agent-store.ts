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
const NEW_KEY = "aos-user-agents";

export type AgentPatch = Partial<
  Pick<Agent, "enabled" | "autonomy" | "thinkingLevel" | "budgetCapUsd" | "escalationPolicy" | "mcpKeys">
>;

type ByTenant = Record<string, Record<string, AgentPatch>>;
type AgentsByTenant = Record<string, Agent[]>;

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

// --- User-created agents (deployed from templates or blank) ------------------

function readAgents(): AgentsByTenant {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(NEW_KEY) ?? "{}") as AgentsByTenant;
  } catch {
    return {};
  }
}

function writeAgents(value: AgentsByTenant): void {
  try {
    localStorage.setItem(NEW_KEY, JSON.stringify(value));
  } catch {
    /* non-fatal in demo */
  }
}

export function userAgents(tenantId: string): Agent[] {
  return readAgents()[tenantId] ?? [];
}

export function addUserAgent(tenantId: string, agent: Agent): void {
  const all = readAgents();
  all[tenantId] = [...(all[tenantId] ?? []), agent];
  writeAgents(all);
}

export function removeUserAgent(tenantId: string, id: string): void {
  const all = readAgents();
  all[tenantId] = (all[tenantId] ?? []).filter((a) => a.id !== id);
  writeAgents(all);
}

export function isUserAgent(tenantId: string, id: string): boolean {
  return (readAgents()[tenantId] ?? []).some((a) => a.id === id);
}

let agentCounter = 0;
export function newAgentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Monotonic counter (not Math.random) so rapid creates can't collide.
  agentCounter += 1;
  return `user-agent-${Date.now()}-${agentCounter}`;
}

// Apply stored overrides onto fixture agents, then append user-created agents
// (overrides apply to those too).
export function mergeAgents(tenantId: string, base: Agent[]): Agent[] {
  const overrides = read()[tenantId];
  const all = [...base, ...userAgents(tenantId)];
  if (!overrides) return all;
  return all.map((a) => (overrides[a.id] ? { ...a, ...overrides[a.id] } : a));
}
