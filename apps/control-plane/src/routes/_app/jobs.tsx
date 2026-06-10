import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, Plus } from "lucide-react";
import { useState } from "react";
import type { Job, Run } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { CardGridSkeleton, EmptyState, Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Drawer } from "#/components/ui/drawer";
import { Separator, StatusDot } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentInProject, agentMap, hasAllTags, matchesSearch, RUN_STATUS_LABEL } from "#/lib/helpers";
import { formatUsd, relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/jobs")({ component: JobsPage });

const SORTS = [
  { value: "name", label: "Name" },
  { value: "runs", label: "Most runs" },
  { value: "schedule", label: "Schedule" },
];

const SOURCES = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "paused", label: "Paused" },
];

function JobsPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("name");
  const [selected, setSelected] = useState<Job | null>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs", tenantId],
    queryFn: () => data.jobs(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["runs", tenantId],
    queryFn: () => data.runs(tenantId!),
    enabled: Boolean(tenantId),
  });

  const amap = agentMap(agents);

  const runsByJob = new Map<string, Run[]>();
  for (const r of runs) {
    if (r.jobId) {
      const arr = runsByJob.get(r.jobId) ?? [];
      arr.push(r);
      runsByJob.set(r.jobId, arr);
    }
  }

  const filtered = jobs.filter((j) => {
    const agent = amap.get(j.agentId);
    if (!agentInProject(agent, activeProjectId)) return false;
    if (f.filters.source === "enabled" && !j.enabled) return false;
    if (f.filters.source === "paused" && j.enabled) return false;
    if (!hasAllTags(j.tags, f.filters.tags)) return false;
    const agentName = agent?.name ?? "";
    return matchesSearch([j.name, agentName, j.scheduleCron], f.filters.search);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "runs") {
      return (runsByJob.get(b.id)?.length ?? 0) - (runsByJob.get(a.id)?.length ?? 0);
    }
    if (f.filters.sort === "schedule") return a.scheduleCron.localeCompare(b.scheduleCron);
    return a.name.localeCompare(b.name);
  });

  const allTags = [...new Set(jobs.flatMap((j) => j.tags ?? []))].sort();

  return (
    <Page>
      <PageHeader
        title="Jobs"
        description="Recurring responsibilities your agents run on a schedule."
        actions={
          <Button size="sm">
            <Plus className="size-4" /> New job
          </Button>
        }
      />

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
          searchPlaceholder="Search jobs…"
        />
      </div>

      {isLoading ? (
        <CardGridSkeleton count={5} columns="" />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="size-8" />}
          title="No jobs match your filters"
          description="Try clearing filters or switching project scope."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((j) => {
            const agent = amap.get(j.agentId);
            const jobRuns = runsByJob.get(j.id) ?? [];
            const skippedCount = jobRuns.filter((r) => r.status === "skipped").length;
            const latestRun = jobRuns.reduce<Run | undefined>((best, r) => {
              const t = r.startedAt ?? r.scheduledFor ?? "";
              const bestT = best ? (best.startedAt ?? best.scheduledFor ?? "") : "";
              return !best || t > bestT ? r : best;
            }, undefined);
            return (
              <JobRow
                key={j.id}
                job={j}
                agentName={agent?.name ?? "Unknown"}
                runCount={jobRuns.length}
                skippedCount={skippedCount}
                latestRun={latestRun}
                onClick={() => setSelected(j)}
              />
            );
          })}
        </div>
      )}

      {selected && (
        <JobDrawer
          job={selected}
          agentName={amap.get(selected.agentId)?.name ?? "Unknown"}
          jobRuns={runsByJob.get(selected.id) ?? []}
          onClose={() => setSelected(null)}
        />
      )}
    </Page>
  );
}

function JobRow({
  job,
  agentName,
  runCount,
  skippedCount,
  latestRun,
  onClick,
}: {
  job: Job;
  agentName: string;
  runCount: number;
  skippedCount: number;
  latestRun?: Run;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer px-4 py-3.5 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-pop)]"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight">{job.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{agentName}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{job.scheduleCron}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <Badge variant={job.enabled ? "success" : "default"}>{job.enabled ? "enabled" : "paused"}</Badge>
            <p className="mt-1 text-xs text-muted-foreground">
              {runCount} {runCount === 1 ? "run" : "runs"}
              {skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
            </p>
          </div>
          {latestRun && <StatusDot status={latestRun.status} pulse={latestRun.status === "running"} />}
        </div>
      </div>
    </Card>
  );
}

function JobDrawer({
  job,
  agentName,
  jobRuns,
  onClose,
}: {
  job: Job;
  agentName: string;
  jobRuns: Run[];
  onClose: () => void;
}) {
  const recentRuns = [...jobRuns]
    .sort((a, b) => {
      const at = a.startedAt ?? a.scheduledFor ?? "";
      const bt = b.startedAt ?? b.scheduledFor ?? "";
      return bt.localeCompare(at);
    })
    .slice(0, 20);

  return (
    <Drawer open onClose={onClose} width="max-w-xl" title={job.name}>
      <div className="space-y-5">
        <div className="space-y-1">
          <SubLabel>Schedule</SubLabel>
          <p className="font-mono text-sm">{job.scheduleCron}</p>
        </div>

        <div className="space-y-1">
          <SubLabel>Agent</SubLabel>
          <p className="text-sm">{agentName}</p>
        </div>

        <div className="space-y-1">
          <SubLabel>Status</SubLabel>
          <Badge variant={job.enabled ? "success" : "default"}>{job.enabled ? "Enabled" : "Paused"}</Badge>
        </div>

        <div className="space-y-1">
          <SubLabel>Instructions</SubLabel>
          <div className="rounded-lg bg-muted px-3.5 py-3">
            <p className="whitespace-pre-wrap text-sm">{job.instructions}</p>
          </div>
        </div>

        {(job.modelOverride || job.thinkingOverride) && (
          <div className="space-y-2">
            <SubLabel>Overrides</SubLabel>
            <div className="grid grid-cols-2 gap-3">
              {job.modelOverride && <Field label="Model override" value={job.modelOverride} />}
              {job.thinkingOverride && <Field label="Thinking override" value={job.thinkingOverride} />}
            </div>
          </div>
        )}

        {(job.tags ?? []).length > 0 && (
          <div className="space-y-2">
            <SubLabel>Tags</SubLabel>
            <div className="flex flex-wrap gap-1.5">
              {(job.tags ?? []).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <SubLabel>Recent runs ({recentRuns.length})</SubLabel>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="space-y-2">
              {recentRuns.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-subtle px-3.5 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={r.status} pulse={r.status === "running"} />
                    <div>
                      <p className="text-sm font-medium">{RUN_STATUS_LABEL[r.status] ?? r.status}</p>
                      <p className="text-xs text-muted-foreground">{relativeTime(r.startedAt ?? r.scheduledFor)}</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.costUsd > 0 ? formatUsd(r.costUsd) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;
}
