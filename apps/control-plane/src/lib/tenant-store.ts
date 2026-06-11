// Client-side tenant (organization) settings overrides. Same demo-overlay
// pattern: editing the org name or monthly budget persists to localStorage and
// overlays demoTenants via data.tenants(); the new budget flows straight into
// the Cost dashboard. In Supabase mode this is a tenants UPDATE.
import type { Tenant } from "@agent-os/shared";

const KEY = "aos-tenant-overrides";

export type TenantPatch = Partial<Pick<Tenant, "name" | "monthlyBudgetUsd">>;

// Keyed by tenant id (tenants aren't themselves tenant-scoped).
type Store = Record<string, TenantPatch>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function write(value: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

export function setTenantOverride(id: string, patch: TenantPatch): void {
  const all = read();
  all[id] = { ...all[id], ...patch };
  write(all);
}

export function mergeTenants(base: Tenant[]): Tenant[] {
  const overrides = read();
  return base.map((t) => (overrides[t.id] ? { ...t, ...overrides[t.id] } : t));
}
