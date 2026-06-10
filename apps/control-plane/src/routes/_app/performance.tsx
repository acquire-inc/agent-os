import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import type { AgentPerfRow } from "@agent-os/shared";
import { CardGridSkeleton, EmptyState, Page, PageHeader } from "#/components/shell/page";
import { DateRangeChips, KpiCard, MetricSection } from "#/components/shell/metrics";
import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
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
        title="Agent performance"
        description="Fleet throughput, reliability, and cost — and which agents are carrying (or burning) the load."
        actions={<DateRangeChips value={range} onChange={setRange} />}
      />

      {isLoading ? (
        <CardGridSkeleton count={4} columns="sm:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <>
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
        </>
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
