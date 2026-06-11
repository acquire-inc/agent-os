// Client-side connector store. In demo mode the app has no backend to write to,
// so user-added MCPs/connectors and status changes (connect / disconnect /
// reconnect) are persisted to localStorage and overlaid on the demo fixtures by
// data.mcps(). In Supabase mode these same actions would hit the API; this store
// keeps the demo experience fully interactive — every button does something real.
import type { ConnectionStatus, Mcp } from "@agent-os/shared";

const MCP_KEY = "aos-user-mcps";
const STATUS_KEY = "aos-mcp-status";
const SCOPES_KEY = "aos-mcp-scopes";

type ByTenant<T> = Record<string, T>;

function read<T>(key: string): ByTenant<T> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as ByTenant<T>;
  } catch {
    return {};
  }
}

function write<T>(key: string, value: ByTenant<T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled storage — non-fatal in demo */
  }
}

// --- User-created MCPs --------------------------------------------------------

export function userMcps(tenantId: string): Mcp[] {
  return read<Mcp[]>(MCP_KEY)[tenantId] ?? [];
}

export function addUserMcp(tenantId: string, mcp: Mcp): void {
  const all = read<Mcp[]>(MCP_KEY);
  all[tenantId] = [...(all[tenantId] ?? []), mcp];
  write(MCP_KEY, all);
}

export function updateUserMcp(tenantId: string, id: string, patch: Partial<Mcp>): void {
  const all = read<Mcp[]>(MCP_KEY);
  all[tenantId] = (all[tenantId] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
  write(MCP_KEY, all);
}

export function removeUserMcp(tenantId: string, id: string): void {
  const all = read<Mcp[]>(MCP_KEY);
  all[tenantId] = (all[tenantId] ?? []).filter((m) => m.id !== id);
  write(MCP_KEY, all);
}

export function isUserMcp(tenantId: string, id: string): boolean {
  return (read<Mcp[]>(MCP_KEY)[tenantId] ?? []).some((m) => m.id === id);
}

// --- Status overrides (apply to fixture + user MCPs) -------------------------
// Lets connect / disconnect / reconnect work on the built-in catalog too.

export function statusOverrides(tenantId: string): Record<string, ConnectionStatus> {
  return read<Record<string, ConnectionStatus>>(STATUS_KEY)[tenantId] ?? {};
}

export function setMcpStatus(tenantId: string, id: string, status: ConnectionStatus): void {
  const all = read<Record<string, ConnectionStatus>>(STATUS_KEY);
  all[tenantId] = { ...(all[tenantId] ?? {}), [id]: status };
  write(STATUS_KEY, all);
}

// --- Granted scopes (the permissions an operator granted on connect) ---------

export function grantedScopes(tenantId: string, id: string): string[] | undefined {
  return read<Record<string, string[]>>(SCOPES_KEY)[tenantId]?.[id];
}

// Connect a connector with an explicit set of granted scopes (least-privilege).
export function grantConnector(tenantId: string, id: string, scopes: string[]): void {
  const all = read<Record<string, string[]>>(SCOPES_KEY);
  all[tenantId] = { ...(all[tenantId] ?? {}), [id]: scopes };
  write(SCOPES_KEY, all);
  setMcpStatus(tenantId, id, "connected");
}

export function revokeConnector(tenantId: string, id: string): void {
  const all = read<Record<string, string[]>>(SCOPES_KEY);
  if (all[tenantId]) {
    delete all[tenantId][id];
    write(SCOPES_KEY, all);
  }
  setMcpStatus(tenantId, id, "disconnected");
}

// Merge a base (fixture) list with user-created rows and apply status overrides.
export function mergeMcps(tenantId: string, base: Mcp[]): Mcp[] {
  const overrides = statusOverrides(tenantId);
  const apply = (m: Mcp): Mcp => (overrides[m.id] ? { ...m, status: overrides[m.id]! } : m);
  return [...base.map(apply), ...userMcps(tenantId).map(apply)];
}

// Stable client-side id for a user-created MCP without Math.random reliance on
// first paint; uses crypto when available, falls back to a time+counter id.
let counter = 0;
export function newMcpId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  counter += 1;
  return `user-mcp-${Date.now()}-${counter}`;
}
