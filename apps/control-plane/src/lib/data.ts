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
  type AgentPerformance,
  type AgentPerfPoint,
  type AgentPerfRow,
  type Approval,
  type CostDay,
  type FleetActivityItem,
  type FleetActivityKind,
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
import { mergeAgents } from "./agent-store";
import { mergeApprovals } from "./approval-store";
import { mergeMcps } from "./connector-store";
import { mergeDocuments } from "./doc-store";
import { mergeTenants } from "./tenant-store";
import { isSupabaseConfigured, supabase } from "./supabase";

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// Phase 67: single source of truth for "current month" across the data layer.
// Relay events store `occurred_at` as timestamptz (UTC), so client-side month
// derivation MUST be UTC to match storage and to keep the Cost dashboard MTD
// budget bar and the Agents page per-agent MTD column from drifting at month
// boundaries in non-UTC operator browsers.
function currentMonthPrefixUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

function nextMonthPrefixUtc(monthPrefix: string): string {
  const parts = monthPrefix.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
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
  const rows = data ?? [];
  // Defense-in-depth: RLS + the explicit tenant filter should already scope
  // this, but never let a policy regression leak cross-tenant rows through the
  // merge layer unnoticed.
  if (rows.some((r) => (r as { tenant_id?: string }).tenant_id !== tenantId)) {
    throw new Error(`sb(${table}): cross-tenant row in response — refusing to surface`);
  }
  return rows.map((r) => mapRow<T>(r as Record<string, unknown>));
}

function byTenant<T extends { tenantId: string }>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => r.tenantId === tenantId);
}

// --- Agent performance (dashboard) ---------------------------------------
// Demo mode synthesizes a realistic fleet from the agent registry so the
// dashboard's charts and leaderboard have shape before any real run fires.
// Seeded per-agent so the numbers are stable across reloads (no flicker).

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayIsoUtc(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Per-model cost/latency bands — opus is slow + pricey, hermes fast + cheap.
function modelBand(model: string): { lo: number; hi: number; durLo: number; durHi: number } {
  const m = model.toLowerCase();
  if (m.includes("opus")) return { lo: 0.12, hi: 0.42, durLo: 22, durHi: 140 };
  if (m.includes("sonnet")) return { lo: 0.03, hi: 0.12, durLo: 10, durHi: 70 };
  if (m.includes("haiku")) return { lo: 0.008, hi: 0.03, durLo: 5, durHi: 30 };
  if (m.includes("405")) return { lo: 0.02, hi: 0.08, durLo: 8, durHi: 55 };
  return { lo: 0.004, hi: 0.02, durLo: 4, durHi: 24 }; // hermes / cheap tiers
}

function synthPerformance(agents: Agent[], sinceDays: number): AgentPerformance {
  const span = sinceDays * 2; // current window + previous window for deltas
  const dayKey = (daysAgo: number) => dayIsoUtc(daysAgo);
  const fleet = new Map<string, AgentPerfPoint>(); // current window, keyed by day
  for (let d = sinceDays - 1; d >= 0; d--) fleet.set(dayKey(d), { day: dayKey(d), runs: 0, failures: 0, costUsd: 0 });
  const prevTotals = { runs: 0, failures: 0, costUsd: 0 };
  const byAgent: AgentPerfRow[] = [];

  for (const agent of agents) {
    const rnd = mulberry32(hashSeed(agent.id));
    const band = modelBand(agent.model);
    const activity = 2 + Math.floor(rnd() * 14); // base runs/day 2..15
    const failRate = rnd() * 0.18; // 0..18%
    const avgDurationSec = Math.round(band.durLo + rnd() * (band.durHi - band.durLo));

    let curRuns = 0;
    let curFails = 0;
    let curCost = 0;
    let lastActiveDaysAgo: number | null = null;

    for (let d = span - 1; d >= 0; d--) {
      const wobble = 0.5 + rnd() * 1.0; // per-day multiplier
      const runsToday = Math.max(0, Math.round(activity * wobble));
      const failsToday = Math.min(runsToday, Math.round(runsToday * failRate * (0.4 + rnd())));
      const costToday = Math.round(runsToday * (band.lo + rnd() * (band.hi - band.lo)) * 1000) / 1000;

      if (d < sinceDays) {
        const pt = fleet.get(dayKey(d));
        if (pt) {
          pt.runs += runsToday;
          pt.failures += failsToday;
          pt.costUsd = Math.round((pt.costUsd + costToday) * 1000) / 1000;
        }
        curRuns += runsToday;
        curFails += failsToday;
        curCost += costToday;
        if (runsToday > 0 && (lastActiveDaysAgo === null || d < lastActiveDaysAgo)) lastActiveDaysAgo = d;
      } else {
        prevTotals.runs += runsToday;
        prevTotals.failures += failsToday;
        prevTotals.costUsd += costToday;
      }
    }

    let lastActiveIso: string | null = null;
    if (lastActiveDaysAgo !== null) {
      const dt = new Date();
      dt.setUTCDate(dt.getUTCDate() - lastActiveDaysAgo);
      dt.setUTCHours(8 + Math.floor(rnd() * 12), Math.floor(rnd() * 60), 0, 0);
      lastActiveIso = dt.toISOString();
    }

    byAgent.push({
      agentId: agent.id,
      runs: curRuns,
      failures: curFails,
      successRate: curRuns > 0 ? (curRuns - curFails) / curRuns : 0,
      costUsd: Math.round(curCost * 100) / 100,
      avgCostUsd: curRuns > 0 ? curCost / curRuns : 0,
      avgDurationSec,
      lastActiveIso,
    });
  }

  prevTotals.costUsd = Math.round(prevTotals.costUsd * 100) / 100;
  return {
    series: Array.from(fleet.values()),
    prevTotals,
    byAgent: byAgent.sort((a, b) => b.runs - a.runs),
  };
}

// Real-runs path: bucket the runs table by start day into the current and
// previous windows.
function aggregateRuns(runs: Run[], agents: Agent[], sinceDays: number): AgentPerformance {
  const startMs = Date.UTC(...isoToYmd(dayIsoUtc(sinceDays - 1)));
  const prevStartMs = Date.UTC(...isoToYmd(dayIsoUtc(sinceDays * 2 - 1)));
  const fleet = new Map<string, AgentPerfPoint>();
  for (let d = sinceDays - 1; d >= 0; d--) fleet.set(dayIsoUtc(d), { day: dayIsoUtc(d), runs: 0, failures: 0, costUsd: 0 });
  const prevTotals = { runs: 0, failures: 0, costUsd: 0 };
  const agg = new Map<string, { runs: number; failures: number; costUsd: number; durSec: number; durN: number; last: string | null }>();
  for (const a of agents) agg.set(a.id, { runs: 0, failures: 0, costUsd: 0, durSec: 0, durN: 0, last: null });

  for (const r of runs) {
    const started = r.startedAt ?? r.scheduledFor;
    if (!started) continue;
    const ms = Date.parse(started);
    const failed = r.status === "failed";
    if (ms >= startMs) {
      const day = started.slice(0, 10);
      const pt = fleet.get(day);
      if (pt) {
        pt.runs += 1;
        if (failed) pt.failures += 1;
        pt.costUsd = Math.round((pt.costUsd + r.costUsd) * 1000) / 1000;
      }
      const a = agg.get(r.agentId);
      if (a) {
        a.runs += 1;
        if (failed) a.failures += 1;
        a.costUsd += r.costUsd;
        if (r.startedAt && r.endedAt) {
          a.durSec += Math.max(0, (Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000);
          a.durN += 1;
        }
        if (!a.last || started > a.last) a.last = started;
      }
    } else if (ms >= prevStartMs) {
      prevTotals.runs += 1;
      if (failed) prevTotals.failures += 1;
      prevTotals.costUsd += r.costUsd;
    }
  }

  const byAgent: AgentPerfRow[] = [];
  for (const [agentId, a] of agg) {
    if (a.runs === 0) continue;
    byAgent.push({
      agentId,
      runs: a.runs,
      failures: a.failures,
      successRate: (a.runs - a.failures) / a.runs,
      costUsd: Math.round(a.costUsd * 100) / 100,
      avgCostUsd: a.costUsd / a.runs,
      avgDurationSec: a.durN > 0 ? Math.round(a.durSec / a.durN) : 0,
      lastActiveIso: a.last,
    });
  }
  prevTotals.costUsd = Math.round(prevTotals.costUsd * 100) / 100;
  return { series: Array.from(fleet.values()), prevTotals, byAgent: byAgent.sort((x, y) => y.runs - x.runs) };
}

function isoToYmd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1];
}

// --- Fleet activity (command center) -----------------------------------------
// The platform's visibility layer. Demo mode synthesizes a realistic recent
// stream of agent actions across connectors so operators see "what is everything
// doing right now"; Supabase mode would read relay/run_activity.

const ACTIVITY_ACTIONS: Record<string, string[]> = {
  Slack: ["slack.post_message(#ops)", "slack.read_thread(#alerts)", "slack.search(query='churn')"],
  Close: ["close.list_leads(stage=qualified)", "close.update_opportunity(stage=won)", "close.get_metrics(period=yesterday)"],
  "Pipeboard × Meta": ["pipeboard.get_spend(period=7d)", "pipeboard.pause_adset(roas<1)", "pipeboard.get_creatives()"],
  Gmail: ["gmail.send(to=lead)", "gmail.search(label=inbound)", "gmail.draft(reply)"],
  "Google Drive": ["drive.read('Q2 plan')", "drive.search('contract')"],
  Stripe: ["stripe.list_charges(period=today)", "stripe.create_refund(charge=ch_…)"],
  GitHub: ["github.create_issue('flaky test')", "github.comment_pr(#412)"],
  HubSpot: ["hubspot.update_contact(stage=mql)", "hubspot.enroll_sequence(welcome)"],
  Notion: ["notion.append_block('weekly digest')", "notion.search('onboarding')"],
  Fireflies: ["fireflies.list_transcripts(since=7d)", "fireflies.summarize(meeting)"],
};
const ACTIVITY_CONNECTORS = Object.keys(ACTIVITY_ACTIONS);
const ACTIVITY_SUMMARIES = [
  "Revenue $14.2k, spend $3.1k, pipeline 23 deals.",
  "Triaged 18 inbound leads — 4 qualified, 2 routed to AE.",
  "Drafted 3 follow-ups, queued for send.",
  "Reconciled yesterday's spend against ROAS floor.",
  "Summarized 5 call transcripts into the weekly digest.",
];
const ACTIVITY_PROPOSALS = [
  "Account 'Northwind' shows churn signals — propose outreach.",
  "Adset 4 spend exceeds ROAS floor — propose pause.",
  "Renewal due in 7d for 'Acme' — propose contract draft.",
  "Refund request over $500 — propose approval.",
];

function synthFleetActivity(agents: Agent[], sinceHours = 24, target = 80): FleetActivityItem[] {
  const items: FleetActivityItem[] = [];
  const nowMs = new Date().getTime();
  for (const agent of agents) {
    const rnd = mulberry32(hashSeed(agent.id + "act"));
    const connectors = ACTIVITY_CONNECTORS.filter(() => rnd() > 0.45);
    const pool = connectors.length > 0 ? connectors : [ACTIVITY_CONNECTORS[Math.floor(rnd() * ACTIVITY_CONNECTORS.length)]!];
    const sessions = 1 + Math.floor(rnd() * 4);
    for (let s = 0; s < sessions; s++) {
      const startMs = nowMs - Math.floor(rnd() * sinceHours * 3600 * 1000);
      let t = startMs;
      const mk = (kind: FleetActivityKind, connector: string | null, message: string) => {
        t += 1000 + Math.floor(rnd() * 40000);
        items.push({ id: `${agent.id}-${s}-${items.length}`, ts: new Date(t).toISOString(), agentId: agent.id, runId: null, kind, connector, message });
      };
      mk("start", null, "Run claimed by runner");

      // V2 lease decisions occasionally surface ("agent held off by another
      // agent on resource Z") — gives operators the platform-real signal
      // even in demo mode.
      if (rnd() > 0.78) {
        items.push({
          id: `${agent.id}-${s}-${items.length}`,
          ts: new Date(t + 2000).toISOString(),
          agentId: agent.id,
          runId: null,
          kind: "lease",
          connector: null,
          message: rnd() > 0.6
            ? `Lease granted on lead/L-${Math.floor(rnd() * 9000) + 1000}`
            : `Lease conflict: target held by another run — yielding`,
          severity: rnd() > 0.6 ? "info" : "warn",
        });
      }

      const calls = 1 + Math.floor(rnd() * 3);
      for (let c = 0; c < calls; c++) {
        const conn = pool[Math.floor(rnd() * pool.length)]!;
        const actions = ACTIVITY_ACTIONS[conn]!;
        mk("tool", conn, actions[Math.floor(rnd() * actions.length)]!);
      }

      // V2 P6 critic-quorum decisions on a fraction of proposals.
      if (rnd() > 0.85) {
        items.push({
          id: `${agent.id}-${s}-${items.length}`,
          ts: new Date(t + 6000).toISOString(),
          agentId: agent.id,
          runId: null,
          kind: "critic",
          connector: null,
          message: rnd() > 0.3
            ? "Critic quorum auto-approved low-stakes proposal (2/2 critics, 0 rejections)"
            : "Critic rejection — escalated to human inbox",
          severity: rnd() > 0.3 ? "info" : "warn",
        });
      }

      // V2 P7 handoff to the next agent on a fraction of runs.
      if (rnd() > 0.8) {
        items.push({
          id: `${agent.id}-${s}-${items.length}`,
          ts: new Date(t + 9000).toISOString(),
          agentId: agent.id,
          runId: null,
          kind: "handoff",
          connector: null,
          message: `Handoff queued → ${rnd() > 0.5 ? "outreach-writer" : "booking-concierge"}`,
        });
      }

      // V2 P4 self-improvement proposals — rare, "lessons recurred".
      if (rnd() > 0.92) {
        items.push({
          id: `${agent.id}-${s}-${items.length}`,
          ts: new Date(t + 11000).toISOString(),
          agentId: agent.id,
          runId: null,
          kind: "improvement",
          connector: null,
          message: "Proposed prompt amendment from 3 recurring lessons (awaiting review)",
        });
      }

      // V2 P5 circuit-breaker — very rare, but visible when it fires.
      if (rnd() > 0.97) {
        items.push({
          id: `${agent.id}-${s}-${items.length}`,
          ts: new Date(t + 13000).toISOString(),
          agentId: agent.id,
          runId: null,
          kind: "circuit",
          connector: null,
          message: "Circuit-breaker tripped: 3 consecutive failures — autonomy demoted to propose",
          severity: "danger",
        });
      }

      if (rnd() > 0.7) mk("proposal", null, ACTIVITY_PROPOSALS[Math.floor(rnd() * ACTIVITY_PROPOSALS.length)]!);
      else mk("summary", null, ACTIVITY_SUMMARIES[Math.floor(rnd() * ACTIVITY_SUMMARIES.length)]!);
    }
  }
  return items.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, target);
}

export const data = {
  async tenants(): Promise<Tenant[]> {
    if (isSupabaseConfigured && supabase) {
      const { data: rows, error } = await supabase.from("tenants").select("*").order("created_at");
      if (error) throw error;
      return (rows ?? []).map((r) => mapRow<Tenant>(r as Record<string, unknown>));
    }
    return mergeTenants(demoTenants);
  },

  async projects(tenantId: string): Promise<Project[]> {
    return isSupabaseConfigured ? sb<Project>("projects", tenantId) : byTenant(demoProjects, tenantId);
  },

  async tags(tenantId: string): Promise<Tag[]> {
    return isSupabaseConfigured ? sb<Tag>("tags", tenantId) : byTenant(demoTags, tenantId);
  },

  async agents(tenantId: string): Promise<Agent[]> {
    if (isSupabaseConfigured) return sb<Agent>("agents", tenantId);
    // Demo mode: overlay operator edits to the agent control surface.
    return mergeAgents(tenantId, byTenant(demoAgents, tenantId));
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
    if (isSupabaseConfigured) return sb<Mcp>("mcps", tenantId);
    // Demo mode: overlay user-created connectors + status changes (add your own).
    return mergeMcps(tenantId, byTenant(demoMcps, tenantId));
  },

  async folders(tenantId: string): Promise<KnowledgeFolder[]> {
    return isSupabaseConfigured ? sb<KnowledgeFolder>("knowledge_folders", tenantId) : byTenant(demoFolders, tenantId);
  },

  async documents(tenantId: string): Promise<Document[]> {
    if (isSupabaseConfigured) return sb<Document>("documents", tenantId);
    return mergeDocuments(tenantId, byTenant(demoDocuments, tenantId));
  },

  async approvals(tenantId: string): Promise<Approval[]> {
    if (isSupabaseConfigured) return sb<Approval>("approvals", tenantId);
    return mergeApprovals(tenantId, byTenant(demoApprovals, tenantId));
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
      const monthPrefix = currentMonthPrefixUtc();
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

  // Phase 67: model.routed events bounded to a specific month. Backs the
  // per-agent MTD column and the by-model panel — both must be unbounded by
  // event count so a busy tenant doesn't silently undercount when a 500-row
  // recent-events cap truncates the month. Server-side filter on Supabase;
  // client-side filter on the demo fixture.
  async modelRoutingForMonth(tenantId: string, monthPrefix: string): Promise<ModelRoutingEvent[]> {
    if (isSupabaseConfigured && supabase) {
      const start = `${monthPrefix}-01`;
      const end = `${nextMonthPrefixUtc(monthPrefix)}-01`;
      const { data: rows, error } = await supabase
        .from("relay_events")
        .select("id, tenant_id, agent_id, run_id, occurred_at, payload")
        .eq("tenant_id", tenantId)
        .eq("event_name", "model.routed")
        .gte("occurred_at", start)
        .lt("occurred_at", end)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (rows ?? []).map((r) => mapRow<ModelRoutingEvent>(r as Record<string, unknown>));
    }
    return byTenant(demoModelRoutingEvents, tenantId).filter((e) => e.occurredAt.startsWith(monthPrefix));
  },

  // Phase 66: per-agent month-to-date spend rolled up from applied
  // model.routed events. Returns a Map<agentId, costUsd>. Drives the
  // 'MTD' figure on each AgentCard and keeps the Agents page aligned
  // with the Cost dashboard's source of truth (relay events, not the
  // runs fixture).
  async agentSpendThisMonth(tenantId: string): Promise<Map<string, number>> {
    const events = await this.modelRoutingForMonth(tenantId, currentMonthPrefixUtc());
    const totals = new Map<string, number>();
    for (const e of events) {
      if (!e.payload.applied) continue;
      if (!e.agentId) continue;
      totals.set(e.agentId, (totals.get(e.agentId) ?? 0) + (e.payload.cost_usd ?? 0));
    }
    return totals;
  },

  // Phase 63: per-model cost roll-up for the cost dashboard. Aggregates
  // applied=true model.routed events whose payload has a cost_usd, grouped
  // by model_ran. Phase 67: bounded to the current month so the panel agrees
  // with the MTD budget bar directly above it on the Cost dashboard.
  async costByModel(tenantId: string): Promise<Array<{ model: string; costUsd: number; runs: number }>> {
    const events = await this.modelRoutingForMonth(tenantId, currentMonthPrefixUtc());
    const totals = new Map<string, { costUsd: number; runs: number }>();
    for (const e of events) {
      if (!e.payload.applied) continue;
      const cost = e.payload.cost_usd ?? 0;
      const model = e.payload.model_ran ?? e.payload.agent_model;
      if (!model) continue; // guard: never key the map on undefined
      const prev = totals.get(model) ?? { costUsd: 0, runs: 0 };
      totals.set(model, { costUsd: prev.costUsd + cost, runs: prev.runs + 1 });
    }
    return Array.from(totals.entries())
      .map(([model, t]) => ({ model, ...t }))
      .sort((a, b) => b.costUsd - a.costUsd);
  },

  // Agent performance dashboard. Supabase mode aggregates the real runs table
  // by start day; demo mode synthesizes a deterministic fleet from the agent
  // registry so the charts and leaderboard have shape out of the box.
  async agentPerformance(tenantId: string, sinceDays: number): Promise<AgentPerformance> {
    const agents = (await this.agents(tenantId)).filter((a) => a.enabled);
    if (isSupabaseConfigured && supabase) {
      const runs = await this.runs(tenantId);
      return aggregateRuns(runs, agents, sinceDays);
    }
    return synthPerformance(agents, sinceDays);
  },

  // Fleet activity feed — the command center stream. Demo synthesizes recent
  // cross-connector agent actions; Supabase mode reads run_activity joined to
  // runs (deferred until live ingest exists).
  async fleetActivity(tenantId: string): Promise<FleetActivityItem[]> {
    const agents = (await this.agents(tenantId)).filter((a) => a.enabled);
    return synthFleetActivity(agents);
  },
};
