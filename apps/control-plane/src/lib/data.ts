// Unified data access. Runs on built-in demo fixtures when Supabase is not
// configured; otherwise reads from Supabase (RLS scopes rows to the user's
// tenants). Both paths share one interface so the UI never branches.
import {
  demoAgents,
  demoApprovals,
  demoCostDays,
  demoDocuments,
  demoFolders,
  demoJobs,
  demoMcps,
  demoModelRoutingEvents,
  demoProjects,
  demoRoutines,
  demoRunActivity,
  demoRuns,
  demoSkills,
  demoTags,
  demoTenants,
  type Agent,
  type Approval,
  type CostDay,
  type Document,
  type Job,
  type KnowledgeFolder,
  type Mcp,
  type ModelRoutingEvent,
  type Project,
  type Routine,
  type Run,
  type RunActivity,
  type Skill,
  type Tag,
  type Tenant,
  type TenantBudgetStatus,
} from "@agent-os/shared";
import { isSupabaseConfigured, supabase } from "./supabase";

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function mapRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out as T;
}

async function sb<T>(table: string, tenantId: string, order?: string): Promise<T[]> {
  if (!supabase) return [];
  let q = supabase.from(table).select("*").eq("tenant_id", tenantId);
  if (order) q = q.order(order, { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => mapRow<T>(r as Record<string, unknown>));
}

function byTenant<T extends { tenantId: string }>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => r.tenantId === tenantId);
}

export const data = {
  async tenants(): Promise<Tenant[]> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase.from("tenants").select("*").order("created_at");
      if (error) throw error;
      return (rows ?? []).map((r) => mapRow<Tenant>(r as Record<string, unknown>));
    }
    return demoTenants;
  },

  async projects(tenantId: string): Promise<Project[]> {
    return isSupabaseConfigured ? sb<Project>("projects", tenantId) : byTenant(demoProjects, tenantId);
  },

  async tags(tenantId: string): Promise<Tag[]> {
    return isSupabaseConfigured ? sb<Tag>("tags", tenantId) : byTenant(demoTags, tenantId);
  },

  async agents(tenantId: string): Promise<Agent[]> {
    if (isSupabaseConfigured) return sb<Agent>("agents", tenantId);
    return byTenant(demoAgents, tenantId);
  },

  async jobs(tenantId: string): Promise<Job[]> {
    return isSupabaseConfigured ? sb<Job>("jobs", tenantId) : byTenant(demoJobs, tenantId);
  },

  async runs(tenantId: string): Promise<Run[]> {
    return isSupabaseConfigured
      ? sb<Run>("runs", tenantId, "scheduled_for")
      : byTenant(demoRuns, tenantId);
  },

  async runActivity(runId: string): Promise<RunActivity[]> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase.from("run_activity").select("*").eq("run_id", runId).order("ts");
      if (error) throw error;
      return (rows ?? []).map((r) => mapRow<RunActivity>(r as Record<string, unknown>));
    }
    return demoRunActivity.filter((a) => a.runId === runId);
  },

  async routines(tenantId: string): Promise<Routine[]> {
    return isSupabaseConfigured ? sb<Routine>("routines", tenantId) : byTenant(demoRoutines, tenantId);
  },

  async skills(tenantId: string): Promise<Skill[]> {
    return isSupabaseConfigured ? sb<Skill>("skills", tenantId) : byTenant(demoSkills, tenantId);
  },

  async mcps(tenantId: string): Promise<Mcp[]> {
    return isSupabaseConfigured ? sb<Mcp>("mcps", tenantId) : byTenant(demoMcps, tenantId);
  },

  async folders(tenantId: string): Promise<KnowledgeFolder[]> {
    return isSupabaseConfigured ? sb<KnowledgeFolder>("knowledge_folders", tenantId) : byTenant(demoFolders, tenantId);
  },

  async documents(tenantId: string): Promise<Document[]> {
    return isSupabaseConfigured ? sb<Document>("documents", tenantId) : byTenant(demoDocuments, tenantId);
  },

  async approvals(tenantId: string): Promise<Approval[]> {
    return isSupabaseConfigured ? sb<Approval>("approvals", tenantId) : byTenant(demoApprovals, tenantId);
  },

  async costDays(tenantId: string): Promise<CostDay[]> {
    if (isSupabaseConfigured) return [];
    return byTenant(demoCostDays, tenantId);
  },

  // Phase 62: live tenant budget posture for the cost dashboard. Uses the
  // tenant_month_to_date_usd() SQL helper (migration 0025) via Supabase RPC
  // for accuracy; falls back to computing from demoCostDays so the page is
  // never blank in demo mode. Thresholds mirror checkTenantBudget in
  // @agent-os/core (warn at >=80%, over at >=100%).
  async tenantBudgetStatus(tenantId: string, monthlyBudgetUsd: number | null): Promise<TenantBudgetStatus> {
    let mtd = 0;
    if (isSupabaseConfigured && supabase) {
      const { data: rpcRows, error } = await supabase.rpc("tenant_month_to_date_usd", { p_tenant_id: tenantId });
      if (!error && rpcRows != null) mtd = Number(rpcRows) || 0;
    } else {
      // Demo path: sum costDays whose ISO day falls in the current month.
      const now = new Date();
      const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      mtd = byTenant(demoCostDays, tenantId)
        .filter((cd) => cd.day.startsWith(monthPrefix))
        .reduce((s, cd) => s + cd.costUsd, 0);
    }

    const cap = monthlyBudgetUsd ?? null;
    const percentUsed = cap != null && cap > 0 ? (mtd / cap) * 100 : 0;
    const remaining = cap != null ? Math.max(0, cap - mtd) : null;

    // Linear EOM projection: mtd * (totalDaysInMonth / dayOfMonth).
    const now = new Date();
    const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const projection = dayOfMonth > 0 ? (mtd * totalDays) / dayOfMonth : mtd;

    const level: TenantBudgetStatus["level"] =
      cap == null || cap === 0 ? "ok" : percentUsed >= 100 ? "over" : percentUsed >= 80 ? "warn" : "ok";

    return {
      capUsd: cap,
      monthToDateUsd: mtd,
      remainingUsd: remaining,
      percentUsed,
      projectionEomUsd: projection,
      level,
    };
  },

  // Phase 61: recent model.routed events for the operator dashboard. Supabase
  // RLS scopes by tenant; the demo fixture is returned otherwise so the page
  // is never blank.
  async modelRoutingRecent(tenantId: string, limit = 50): Promise<ModelRoutingEvent[]> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase
        .from("relay_events")
        .select("id, tenant_id, agent_id, run_id, occurred_at, payload")
        .eq("tenant_id", tenantId)
        .eq("event_name", "model.routed")
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (rows ?? []).map((r) => mapRow<ModelRoutingEvent>(r as Record<string, unknown>));
    }
    return byTenant(demoModelRoutingEvents, tenantId).slice(0, limit);
  },
};
