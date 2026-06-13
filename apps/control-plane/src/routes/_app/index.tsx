import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Clock, Coins, Zap } from "lucide-react";
import { useState } from "react";
import type { Run } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { OnboardingChecklist } from "#/components/onboarding-checklist";
import { CardGridSkeleton, EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { Separator, StatusDot } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import {
  RUN_STATUS_LABEL,
  agentInProject,
  agentMap,
  hasAllTags,
  matchesSearch,
  statusBadgeVariant,
} from "#/lib/helpers";
import { formatUsd, relativeTime } from "#/lib/utils";
import { RunDetail } from "#/components/run-detail";

export const Route = createFileRoute("/_app/")({ component: RunsPage });

const SORTS = [
  { value: "recent", label: "Most recent" },
  { value: "cost", label: "Highest cost" },
  { value: "agent", label: "Agent name" },
];
const SOURCES = [
  { value: "all", label: "All triggers" },
  { value: "schedule", label: "Schedule" },
  { value: "routine", label: "Routine" },
  { value: "manual", label: "Manual" },
  { value: "api", label: "API" },
];

const BOARD: { key: Run["status"]; label: string }[] = [
  { key: "running", label: "Running" },
  { key: "waiting", label: "Needs you" },
  { key: "scheduled", label: "Scheduled" },
  { key: "done", label: "Recent" },
];

function RunsPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("recent");
  const [selected, setSelected] = useState<Run | null>(null);

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["runs", tenantId],
    queryFn: () => data.runs(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });
  const amap = agentMap(agents);

  const filtered = runs.filter((r) => {
    const agent = amap.get(r.agentId);
    if (!agentInProject(agent, activeProjectId)) return false;
    if (f.filters.source !== "all" && r.triggerSource !== f.filters.source) return false;
    if (!hasAllTags(agent?.tags, f.filters.tags)) return false;
    return matchesSearch([agent?.name ?? "", r.summary ?? "", r.status], f.filters.search);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "cost") return b.costUsd - a.costUsd;
    if (f.filters.sort === "agent") return (amap.get(a.agentId)?.name ?? "").localeCompare(amap.get(b.agentId)?.name ?? "");
    const at = a.startedAt ?? a.scheduledFor ?? "";
    const bt = b.startedAt ?? b.scheduledFor ?? "";
    return bt.localeCompare(at);
  });

  const todayCost = filtered.reduce((sum, r) => sum + r.costUsd, 0);
  const allTags = [...new Set(agents.flatMap((a) => a.tags ?? []))].sort();

  function statusGroup(status: Run["status"]) {
    if (status === "done") return sorted.filter((r) => ["done", "failed", "skipped"].includes(r.status));
    if (status === "scheduled") return sorted.filter((r) => ["scheduled", "pending"].includes(r.status));
    return sorted.filter((r) => r.status === status);
  }

  return (
    <Page>
      <PageHeader title="Runs" description="Live view of everything your agents are doing right now." />

      {tenantId && <OnboardingChecklist tenantId={tenantId} />}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Zap className="size-4" />} label="Running" value={String(statusGroup("running").length)} tone="info" />
        <Stat icon={<Clock className="size-4" />} label="Needs you" value={String(statusGroup("waiting").length)} tone="warning" />
        <Stat icon={<Activity className="size-4" />} label="Scheduled" value={String(statusGroup("scheduled").length)} />
        <Stat icon={<Coins className="size-4" />} label="Spend today" value={formatUsd(todayCost)} />
      </div>

      <div className="mb-4">
        <FilterBar
          filters={f.filters}
          onSearch={f.setSearch}
          onToggleTag={f.toggleTag}
          onSource={f.setSource}
          onSort={f.setSort}
          availableTags={allTags}
          sources={SOURCES}
          sortOptions={SORTS}
          searchPlaceholder="Search runs…"
        />
      </div>

      {isLoading ? (
        <CardGridSkeleton count={4} columns="lg:grid-cols-2 xl:grid-cols-4" />
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Activity className="size-8" />} title="No runs match your filters" description="Try clearing filters or switching project scope." />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-4">
          {BOARD.map((col) => {
            const items = statusGroup(col.key);
            return (
              <div key={col.key} className="flex flex-col gap-2">
                <SectionLabel>
                  {col.label} · {items.length}
                </SectionLabel>
                {items.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nothing here.</p>}
                {items.map((r) => (
                  <RunCard key={r.id} run={r} agentName={amap.get(r.agentId)?.name ?? "Unknown"} onClick={() => setSelected(r)} />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {selected && <RunDetail run={selected} agent={amap.get(selected.agentId)} onClose={() => setSelected(null)} />}
    </Page>
  );
}

function RunCard({ run, agentName, onClick }: { run: Run; agentName: string; onClick: () => void }) {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer p-3.5 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-pop)]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot status={run.status} pulse={run.status === "running"} />
          <span className="text-sm font-medium">{agentName}</span>
          {/* V2 P3: surface attempt number when this run is one attempt of
              a multi-run objective. Single-shot runs (no objective) don't
              render anything. */}
          {run.objectiveId && (run.attemptNumber ?? 1) > 1 && (
            <Badge variant="outline" className="text-[10px]" title={`Attempt ${run.attemptNumber} of objective ${run.objectiveId.slice(0, 8)}…`}>
              attempt {run.attemptNumber}
            </Badge>
          )}
        </div>
        <Badge variant={statusBadgeVariant(run.status)}>{RUN_STATUS_LABEL[run.status]}</Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
        {run.summary ?? (run.status === "running" ? "Working…" : "—")}
      </p>
      <Separator className="my-2.5" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{relativeTime(run.startedAt ?? run.scheduledFor)}</span>
        <span className="font-mono">{run.costUsd > 0 ? formatUsd(run.costUsd) : "—"}</span>
      </div>
    </Card>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "info" | "warning" }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className={tone === "info" ? "text-info" : tone === "warning" ? "text-warning" : ""}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}
