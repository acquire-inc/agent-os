import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { CostDay, Agent, Run } from "@agent-os/shared";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentInProject } from "#/lib/helpers";
import { formatNumber, formatUsd } from "#/lib/utils";

export const Route = createFileRoute("/_app/cost")({ component: CostPage });

const PERIODS: { value: 7 | 14 | 30; label: string }[] = [
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
];

function shortDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CostPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const [period, setPeriod] = useState<7 | 14 | 30>(14);

  const { data: costDays = [] } = useQuery<CostDay[]>({
    queryKey: ["costDays", tenantId],
    queryFn: () => data.costDays(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: runs = [] } = useQuery<Run[]>({
    queryKey: ["runs", tenantId],
    queryFn: () => data.runs(tenantId!),
    enabled: Boolean(tenantId),
  });

  // Slice to selected period
  const sliced = costDays.slice(-period);

  // Chart data
  const chartData = sliced.map((cd) => ({ day: shortDay(cd.day), cost: cd.costUsd }));

  // Stat aggregates over period
  const periodSpend = sliced.reduce((s, cd) => s + cd.costUsd, 0);
  const periodTokens = sliced.reduce((s, cd) => s + cd.tokensIn + cd.tokensOut, 0);
  const avgPerDay = sliced.length > 0 ? periodSpend / period : 0;
  const monthlyBudget = activeTenant?.monthlyBudgetUsd ?? null;

  // Budget cap
  const monthSpend = costDays.reduce((s, cd) => s + cd.costUsd, 0);
  const monthBudget = monthlyBudget ?? 0;
  const pct = monthBudget > 0 ? Math.min(100, (monthSpend / monthBudget) * 100) : 0;
  const budgetBarColor =
    pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success";

  // Per-agent cost from runs, filtered by project
  const agentCostMap = new Map<string, number>();
  for (const r of runs) {
    agentCostMap.set(r.agentId, (agentCostMap.get(r.agentId) ?? 0) + r.costUsd);
  }
  const agentRows = agents
    .filter((a) => agentInProject(a, activeProjectId))
    .map((a) => ({ agent: a, cost: agentCostMap.get(a.id) ?? 0 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  const maxAgentCost = agentRows.length > 0 ? (agentRows[0]?.cost ?? 1) : 1;

  return (
    <Page>
      <PageHeader
        title="Cost"
        description="Per-tenant, per-agent spend with caps and alerts."
        actions={
          <div className="flex items-center rounded-lg border border-border p-0.5">
            {PERIODS.map(({ value, label }) => (
              <Button
                key={value}
                size="sm"
                variant={period === value ? "primary" : "ghost"}
                onClick={() => setPeriod(value)}
                className="h-7 px-2.5 text-xs"
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      {/* Stat cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Spend (${period}d)`} value={formatUsd(periodSpend)} />
        <Stat label="Tokens" value={formatNumber(periodTokens)} />
        <Stat label="Avg / day" value={formatUsd(avgPerDay)} />
        <Stat label="Budget" value={monthlyBudget != null ? formatUsd(monthlyBudget) : "—"} />
      </div>

      {/* Budget cap */}
      <Card className="mb-5 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Monthly budget</span>
          <div className="flex items-center gap-2">
            {pct >= 100 && <Badge variant="danger">Over budget</Badge>}
            {pct >= 80 && pct < 100 && <Badge variant="warning">80% reached</Badge>}
            <span className="font-mono text-sm text-muted-foreground">
              {formatUsd(monthSpend)} of {monthBudget > 0 ? formatUsd(monthBudget) : "—"}
            </span>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${budgetBarColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </Card>

      {/* Spend over time chart */}
      <Card className="mb-5 p-5">
        <SectionLabel>Spend over time</SectionLabel>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
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
              tickFormatter={(v: number) => "$" + (v >= 1 ? v.toFixed(2) : v.toFixed(4))}
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              width={60}
            />
            <Tooltip content={<CostTooltip />} />
            <Area
              type="monotone"
              dataKey="cost"
              stroke="var(--color-primary)"
              fill="url(#costFill)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--color-primary)", stroke: "var(--color-card)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* By agent */}
      <Card className="mb-5 p-5">
        <SectionLabel>By agent</SectionLabel>
        {agentRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agent spend data.</p>
        ) : (
          <div className="space-y-3">
            {agentRows.map(({ agent, cost }) => (
              <div key={agent.id} className="flex items-center gap-3">
                <div className="flex w-40 shrink-0 items-center gap-2 overflow-hidden">
                  <span className="truncate text-sm font-medium">{agent.name}</span>
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    {agent.model.replace("claude-", "")}
                  </Badge>
                </div>
                <div className="flex-1">
                  <div
                    className="h-1.5 rounded-full bg-primary transition-all"
                    style={{ width: maxAgentCost > 0 ? `${(cost / maxAgentCost) * 100}%` : "0%" }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-sm text-muted-foreground">
                  {formatUsd(cost)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Model tiering note */}
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Model tiering</span> — haiku for triage, sonnet default, opus for hard reasoning. Caps enforce per-run{" "}
          <span className="font-mono text-xs">max_budget_usd</span> +{" "}
          <span className="font-mono text-xs">task_budget</span>.
        </p>
      </Card>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}

function CostTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-[var(--shadow-pop)]">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold">{formatUsd(payload[0]?.value ?? 0)}</p>
    </div>
  );
}
