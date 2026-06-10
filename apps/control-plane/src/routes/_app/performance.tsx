import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import type { Agent, AgentPerfPoint, AgentPerfRow } from "@agent-os/shared";
import { CardGridSkeleton, EmptyState, Page, PageHeader } from "#/components/shell/page";
import { DateRangeChips, KpiCard, MetricSection, RankBarRow } from "#/components/shell/metrics";
import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentInProject, agentMap } from "#/lib/helpers";
import { formatNumber, formatUsd, relativeTime } from "#/lib/utils";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/_app/performance")({ component: PerformancePage });

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

function shortDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type SortKey = "runs" | "successRate" | "avgCostUsd" | "costUsd" | "avgDurationSec" | "lastActiveIso";

function PerformancePage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const [range, setRange] = useState(14);
  const [sortKey, setSortKey] = useState<SortKey>("runs");

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: perf, isLoading } = useQuery({
    queryKey: ["agentPerformance", tenantId, range],
    queryFn: () => data.agentPerformance(tenantId!, range),
    enabled: Boolean(tenantId),
  });

  const amap = agentMap(agents);
  const inScope = (agentId: string) => agentInProject(amap.get(agentId), activeProjectId);

  const series = perf?.series ?? [];
  const prev = perf?.prevTotals ?? { runs: 0, failures: 0, costUsd: 0 };
  const rows = (perf?.byAgent ?? []).filter((r) => inScope(r.agentId));

  // Fleet totals over the window.
  const totalRuns = series.reduce((s, p) => s + p.runs, 0);
  const totalFailures = series.reduce((s, p) => s + p.failures, 0);
  const totalCost = series.reduce((s, p) => s + p.costUsd, 0);
  const successRate = totalRuns > 0 ? (totalRuns - totalFailures) / totalRuns : 0;
  const avgCost = totalRuns > 0 ? totalCost / totalRuns : 0;

  const prevSuccess = prev.runs > 0 ? (prev.runs - prev.failures) / prev.runs : 0;
  const prevAvgCost = prev.runs > 0 ? prev.costUsd / prev.runs : 0;

  // Sparkline series.
  const runsSpark = series.map((p) => p.runs);
  const successSpark = series.map((p) => (p.runs > 0 ? ((p.runs - p.failures) / p.runs) * 100 : 0));
  const spendSpark = series.map((p) => p.costUsd);
  const avgCostSpark = series.map((p) => (p.runs > 0 ? p.costUsd / p.runs : 0));

  // Throughput chart: successes vs failures stacked per day.
  const chartData = series.map((p) => ({
    day: shortDay(p.day),
    Successful: p.runs - p.failures,
    Failed: p.failures,
  }));

  const sortedRows = [...rows].sort((a, b) => {
    if (sortKey === "lastActiveIso") return (b.lastActiveIso ?? "").localeCompare(a.lastActiveIso ?? "");
    return (b[sortKey] as number) - (a[sortKey] as number);
  });

  const rangeLabel = range === 1 ? "today" : `last ${range}d`;

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        description="Fleet throughput, reliability, and cost — and which agents are carrying (or burning) the load."
        actions={<DateRangeChips value={range} onChange={setRange} />}
      />

      {isLoading ? (
        <CardGridSkeleton count={4} columns="sm:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <Tabs defaultValue="agents">
          <TabsList className="mb-5">
            <TabsTrigger value="agents">Agent performance</TabsTrigger>
            <TabsTrigger value="fleet">Fleet analytics</TabsTrigger>
            <TabsTrigger value="cost">Cost analytics</TabsTrigger>
            <TabsTrigger value="models">Model routing</TabsTrigger>
          </TabsList>
          <TabsContent value="agents">
          <MetricSection title="Fleet">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Total runs"
                value={formatNumber(totalRuns)}
                deltaPct={pctChange(totalRuns, prev.runs)}
                goodDirection="up"
                spark={runsSpark}
                note={`Agent runs dispatched ${rangeLabel}, vs. the prior ${range}d.`}
              />
              <KpiCard
                label="Success rate"
                value={`${(successRate * 100).toFixed(1)}%`}
                deltaPct={pctChange(successRate, prevSuccess)}
                goodDirection="up"
                spark={successSpark}
                sparkColor="var(--color-success)"
                note={`${formatNumber(totalRuns - totalFailures)} of ${formatNumber(totalRuns)} runs ended clean (excludes still-running).`}
              />
              <KpiCard
                label="Total spend"
                value={formatUsd(totalCost)}
                deltaPct={pctChange(totalCost, prev.costUsd)}
                goodDirection="down"
                spark={spendSpark}
                sparkColor="var(--color-warning)"
                note={`Model spend across the fleet ${rangeLabel}. Down is good.`}
              />
              <KpiCard
                label="Avg cost / run"
                value={formatUsd(avgCost)}
                deltaPct={pctChange(avgCost, prevAvgCost)}
                goodDirection="down"
                spark={avgCostSpark}
                sparkColor="var(--color-warning)"
                note="Total spend ÷ runs. The lever the model router optimizes."
              />
            </div>
          </MetricSection>

          <MetricSection title="Throughput">
            <Card className="p-5">
              {totalRuns === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No runs in this window.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="okFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="failFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-danger)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-danger)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                      axisLine={{ stroke: "var(--color-border)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                      axisLine={{ stroke: "var(--color-border)" }}
                      tickLine={false}
                      width={32}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="Successful"
                      stackId="1"
                      stroke="var(--color-primary)"
                      fill="url(#okFill)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="Failed"
                      stackId="1"
                      stroke="var(--color-danger)"
                      fill="url(#failFill)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>
          </MetricSection>

          <MetricSection title="By agent">
            {sortedRows.length === 0 ? (
              <EmptyState
                icon={<Activity className="size-8" />}
                title="No agent activity in this window"
                description="Widen the range or switch project scope."
              />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Agent</th>
                        <SortHeader label="Runs" k="runs" sortKey={sortKey} onSort={setSortKey} />
                        <SortHeader label="Success" k="successRate" sortKey={sortKey} onSort={setSortKey} />
                        <SortHeader label="Avg cost" k="avgCostUsd" sortKey={sortKey} onSort={setSortKey} />
                        <SortHeader label="Spend" k="costUsd" sortKey={sortKey} onSort={setSortKey} />
                        <SortHeader label="Avg dur" k="avgDurationSec" sortKey={sortKey} onSort={setSortKey} />
                        <SortHeader label="Last active" k="lastActiveIso" sortKey={sortKey} onSort={setSortKey} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((r) => (
                        <AgentRow key={r.agentId} row={r} name={amap.get(r.agentId)?.name ?? "Unknown"} model={amap.get(r.agentId)?.model ?? ""} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </MetricSection>
          </TabsContent>

          <TabsContent value="fleet">
            <FleetAnalyticsTab rows={rows} series={series} amap={amap} />
          </TabsContent>

          <TabsContent value="cost">
            <CostAnalyticsTab rows={rows} amap={amap} monthlyBudget={activeTenant?.monthlyBudgetUsd ?? null} rangeLabel={rangeLabel} />
          </TabsContent>

          <TabsContent value="models">
            <ModelRoutingTab tenantId={tenantId!} amap={amap} />
          </TabsContent>
        </Tabs>
      )}
    </Page>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cnHeader(active)}
        aria-pressed={active}
      >
        {label}
        <ArrowUpDown className="size-3" />
      </button>
    </th>
  );
}

function cnHeader(active: boolean): string {
  return [
    "inline-flex items-center gap-1 transition-colors hover:text-foreground focus-visible:outline-none",
    active ? "text-foreground" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function successTone(rate: number): "success" | "warning" | "danger" {
  if (rate >= 0.95) return "success";
  if (rate >= 0.85) return "warning";
  return "danger";
}

function AgentRow({ row, name, model }: { row: AgentPerfRow; name: string; model: string }) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          {model && (
            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
              {model.replace("anthropic/", "").replace("nousresearch/", "").replace("claude-", "")}
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-3 font-mono tabular-nums">{formatNumber(row.runs)}</td>
      <td className="px-4 py-3">
        <Badge variant={successTone(row.successRate)}>{(row.successRate * 100).toFixed(0)}%</Badge>
      </td>
      <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">{formatUsd(row.avgCostUsd)}</td>
      <td className="px-4 py-3 font-mono tabular-nums">{formatUsd(row.costUsd)}</td>
      <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">{row.avgDurationSec}s</td>
      <td className="px-4 py-3 text-muted-foreground">{row.lastActiveIso ? relativeTime(row.lastActiveIso) : "—"}</td>
    </tr>
  );
}

// --- Cost analytics tab ------------------------------------------------------

function shortModel(model: string): string {
  return model.replace("anthropic/", "").replace("nousresearch/", "").replace("claude-", "");
}

// --- Fleet analytics tab -----------------------------------------------------

function FleetAnalyticsTab({
  rows,
  series,
  amap,
}: {
  rows: AgentPerfRow[];
  series: AgentPerfPoint[];
  amap: Map<string, Agent>;
}) {
  const active = rows.filter((r) => r.runs > 0);
  const failing = active.filter((r) => r.successRate < 0.85);
  const busiest = [...active].sort((a, b) => b.runs - a.runs)[0];
  const slowest = [...active].sort((a, b) => b.avgDurationSec - a.avgDurationSec)[0];

  const topByRuns = [...active].sort((a, b) => b.runs - a.runs).slice(0, 8);
  const maxRuns = topByRuns.reduce((m, r) => Math.max(m, r.runs), 0) || 1;
  const reliability = [...active].sort((a, b) => a.successRate - b.successRate).slice(0, 10);

  const failData = series.map((p) => ({ day: shortDay(p.day), Failures: p.failures }));
  const totalFailures = series.reduce((s, p) => s + p.failures, 0);

  const name = (id: string) => amap.get(id)?.name ?? "Unknown";

  return (
    <>
      <MetricSection title="Fleet health">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Active agents" value={String(active.length)} note="Agents with at least one run in the window." />
          <KpiCard
            label="Failing agents"
            value={String(failing.length)}
            goodDirection="down"
            note="Agents under 85% success — worth a look."
          />
          <KpiCard label="Busiest" value={busiest ? name(busiest.agentId) : "—"} note={busiest ? `${formatNumber(busiest.runs)} runs` : "No activity"} />
          <KpiCard label="Slowest" value={slowest ? name(slowest.agentId) : "—"} note={slowest ? `${slowest.avgDurationSec}s avg` : "No activity"} />
        </div>
      </MetricSection>

      <MetricSection title="Top agents by volume">
        <Card className="p-4">
          {topByRuns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No agent activity in this window.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {topByRuns.map((r) => (
                <RankBarRow
                  key={r.agentId}
                  label={name(r.agentId)}
                  badge={
                    <Badge variant={successTone(r.successRate)} className="shrink-0">
                      {(r.successRate * 100).toFixed(0)}%
                    </Badge>
                  }
                  value={`${formatNumber(r.runs)} runs`}
                  pct={(r.runs / maxRuns) * 100}
                />
              ))}
            </div>
          )}
        </Card>
      </MetricSection>

      <MetricSection title="Reliability">
        <Card className="overflow-hidden">
          {reliability.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No activity in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Agent</th>
                    <th className="px-4 py-3 font-medium">Success</th>
                    <th className="px-4 py-3 font-medium">Failures</th>
                    <th className="px-4 py-3 font-medium">Avg dur</th>
                    <th className="px-4 py-3 font-medium">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {reliability.map((r) => (
                    <tr key={r.agentId} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{name(r.agentId)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={successTone(r.successRate)}>{(r.successRate * 100).toFixed(0)}%</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">{formatNumber(r.failures)}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">{r.avgDurationSec}s</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.lastActiveIso ? relativeTime(r.lastActiveIso) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </MetricSection>

      <MetricSection title={`Daily failures · ${formatNumber(totalFailures)} total`}>
        <Card className="p-5">
          {totalFailures === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No failures in this window. 🎉</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={failData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="failOnlyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-danger)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-danger)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="Failures" stroke="var(--color-danger)" fill="url(#failOnlyFill)" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
      </MetricSection>
    </>
  );
}

function CostAnalyticsTab({
  rows,
  amap,
  monthlyBudget,
  rangeLabel,
}: {
  rows: AgentPerfRow[];
  amap: Map<string, Agent>;
  monthlyBudget: number | null;
  rangeLabel: string;
}) {
  // Derive everything from the same fleet data as the Agent performance tab so
  // the two tabs always agree (the real cost ledger is empty in demo mode).
  const windowSpend = rows.reduce((s, r) => s + r.costUsd, 0);
  const cap = monthlyBudget;
  const pctUsed = cap && cap > 0 ? (windowSpend / cap) * 100 : 0;
  const remaining = cap != null ? Math.max(0, cap - windowSpend) : null;
  const avgRun = rows.reduce((s, r) => s + r.runs, 0);
  const projection = windowSpend * (30 / 14); // rough end-of-month extrapolation from the window
  const levelColor = pctUsed > 100 ? "var(--color-danger)" : pctUsed > 80 ? "var(--color-warning)" : "var(--color-success)";

  const byModelMap = new Map<string, { costUsd: number; runs: number }>();
  for (const r of rows) {
    const model = amap.get(r.agentId)?.model ?? "unknown";
    const prev = byModelMap.get(model) ?? { costUsd: 0, runs: 0 };
    byModelMap.set(model, { costUsd: prev.costUsd + r.costUsd, runs: prev.runs + r.runs });
  }
  const byModel = [...byModelMap.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const maxModel = byModel.reduce((m, r) => Math.max(m, r.costUsd), 0) || 1;

  const topSpenders = [...rows].sort((a, b) => b.costUsd - a.costUsd).slice(0, 8);
  const maxSpender = topSpenders.reduce((m, r) => Math.max(m, r.costUsd), 0) || 1;

  return (
    <>
      <MetricSection title="Budget">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label={`Spend (${rangeLabel})`} value={formatUsd(windowSpend)} note={`Fleet model spend over the ${rangeLabel} across ${avgRun} runs.`} />
          <KpiCard label="Remaining" value={remaining != null ? formatUsd(remaining) : "—"} note="Monthly budget cap minus window spend." />
          <KpiCard label="% of budget" value={cap ? `${Math.round(pctUsed)}%` : "—"} note="Share of the monthly cap consumed." />
          <KpiCard label="EOM projection" value={formatUsd(projection)} goodDirection="down" note="Linear projection to end of month." />
        </div>
        {cap != null && (
          <Card className="mt-3 p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Budget used</span>
              <span className="font-mono">
                {formatUsd(windowSpend)} / {formatUsd(cap)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pctUsed)}%`, background: levelColor }} />
            </div>
          </Card>
        )}
      </MetricSection>

      <MetricSection title="Spend by model">
        <Card className="p-4">
          {byModel.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No model spend in this window.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {byModel.map((r) => (
                <RankBarRow
                  key={r.model}
                  label={<code className="text-xs">{shortModel(r.model)}</code>}
                  value={`${formatUsd(r.costUsd)} · ${r.runs} runs`}
                  pct={(r.costUsd / maxModel) * 100}
                />
              ))}
            </div>
          )}
        </Card>
      </MetricSection>

      <MetricSection title="Top spenders">
        <Card className="p-4">
          {topSpenders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No spend in range.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {topSpenders.map((r) => (
                <RankBarRow
                  key={r.agentId}
                  label={amap.get(r.agentId)?.name ?? "Unknown"}
                  value={`${formatUsd(r.costUsd)} · ${formatUsd(r.avgCostUsd)}/run`}
                  pct={(r.costUsd / maxSpender) * 100}
                  color="var(--color-warning)"
                />
              ))}
            </div>
          )}
        </Card>
      </MetricSection>
    </>
  );
}

// --- Model routing tab -------------------------------------------------------

function ModelRoutingTab({ tenantId, amap }: { tenantId: string; amap: Map<string, Agent> }) {
  const { data: events = [] } = useQuery({
    queryKey: ["modelRoutingRecent", tenantId],
    queryFn: () => data.modelRoutingRecent(tenantId),
    enabled: Boolean(tenantId),
  });

  const applied = events.filter((e) => e.payload.applied).length;
  const audit = events.length - applied;
  const models = new Set(events.map((e) => e.payload.model_ran ?? e.payload.agent_model)).size;

  return (
    <>
      <MetricSection title="Routing">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Applied forks" value={String(applied)} note="Decisions that changed the model actually run." />
          <KpiCard label="Audit-only" value={String(audit)} note="Recommendations recorded but not applied." />
          <KpiCard label="Models touched" value={String(models)} note="Distinct models in recent decisions." />
        </div>
      </MetricSection>

      <MetricSection title="Recent decisions">
        <Card className="overflow-hidden">
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No routing events yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {events.slice(0, 20).map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{amap.get(e.agentId ?? "")?.name ?? "—"}</span>
                    <span className="text-muted-foreground">→</span>
                    <code className="truncate text-xs text-muted-foreground">{e.payload.model_ran ?? e.payload.agent_model}</code>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={e.payload.applied ? "success" : "outline"}>{e.payload.applied ? "applied" : "audit"}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{formatUsd(e.payload.cost_usd ?? 0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </MetricSection>
    </>
  );
}
