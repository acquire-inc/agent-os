import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Calendar, Clock, Plus, Repeat } from "lucide-react";
import type { Job, Routine } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Separator } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { inProjectScope, matchesSearch } from "#/lib/helpers";

export const Route = createFileRoute("/_app/routines")({ component: RoutinesPage });

const SORTS = [
  { value: "cadence", label: "Cadence" },
  { value: "name", label: "Name" },
  { value: "jobs", label: "Most jobs" },
];

const SOURCES = [
  { value: "all", label: "All cadences" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "cron", label: "Custom cron" },
];

const CADENCE_ORDER: Routine["cadence"][] = ["daily", "weekly", "monthly", "cron"];

const CADENCE_LABEL: Record<Routine["cadence"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  cron: "Custom cron",
};

const CADENCE_NEXT_RUN: Record<Routine["cadence"], string> = {
  daily: "Tomorrow, 06:30",
  weekly: "Saturday, 07:00",
  monthly: "1st of month",
  cron: "Per cron",
};

function cadenceBadgeVariant(cadence: Routine["cadence"]): "primary" | "info" | "default" {
  if (cadence === "daily") return "primary";
  if (cadence === "weekly") return "info";
  return "default";
}

function RoutinesPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("cadence");

  const { data: routines = [] } = useQuery({
    queryKey: ["routines", tenantId],
    queryFn: () => data.routines(tenantId!),
    enabled: Boolean(tenantId),
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs", tenantId],
    queryFn: () => data.jobs(tenantId!),
    enabled: Boolean(tenantId),
  });

  const jobMap = new Map<string, Job>(jobs.map((j) => [j.id, j]));

  const filtered = routines.filter((r) => {
    if (!inProjectScope(r.projectId, activeProjectId)) return false;
    if (f.filters.source !== "all" && r.cadence !== f.filters.source) return false;
    return matchesSearch([r.name], f.filters.search);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "name") return a.name.localeCompare(b.name);
    if (f.filters.sort === "jobs") return b.jobIds.length - a.jobIds.length;
    // cadence order
    return CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence);
  });

  const isCadenceGrouped = f.filters.sort === "cadence";

  return (
    <Page>
      <PageHeader
        title="Routines"
        description="Daily, weekly, and monthly bundles of jobs your company runs on cadence."
        actions={
          <Button size="sm">
            <Plus className="size-4" /> New routine
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
          availableTags={[]}
          sources={SOURCES}
          sortOptions={SORTS}
          searchPlaceholder="Search routines…"
        />
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Repeat className="size-8" />}
          title="No routines here yet"
          description="Create a routine or switch project scope."
        />
      ) : isCadenceGrouped ? (
        <div className="space-y-6">
          {CADENCE_ORDER.map((cadence) => {
            const group = sorted.filter((r) => r.cadence === cadence);
            if (group.length === 0) return null;
            return (
              <div key={cadence}>
                <SectionLabel>
                  {CADENCE_LABEL[cadence]} · {group.length}
                </SectionLabel>
                <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((r) => (
                    <RoutineCard key={r.id} routine={r} jobMap={jobMap} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((r) => (
            <RoutineCard key={r.id} routine={r} jobMap={jobMap} />
          ))}
        </div>
      )}
    </Page>
  );
}

function RoutineCard({ routine, jobMap }: { routine: Routine; jobMap: Map<string, Job> }) {
  const resolvedJobs = routine.jobIds.map((id) => jobMap.get(id)).filter((j): j is Job => j !== undefined);

  return (
    <Card className="p-5 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-pop)]">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold leading-tight">{routine.name}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant={cadenceBadgeVariant(routine.cadence)}>{CADENCE_LABEL[routine.cadence]}</Badge>
          <Badge variant={routine.enabled ? "success" : "default"}>
            {routine.enabled ? "enabled" : "paused"}
          </Badge>
        </div>
      </div>

      {/* Next run */}
      <div className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="size-3.5 shrink-0" />
        <span>
          Next run: <span className="font-medium text-foreground">{CADENCE_NEXT_RUN[routine.cadence]}</span>
        </span>
      </div>

      <Separator className="my-3" />

      {/* Jobs list */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Calendar className="size-3.5" />
          <span>{resolvedJobs.length} {resolvedJobs.length === 1 ? "job" : "jobs"}</span>
        </div>
        {resolvedJobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No jobs attached.</p>
        ) : (
          <div className="flex flex-col gap-1.5 pt-0.5">
            {resolvedJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded-md border border-border bg-subtle px-2.5 py-1.5"
              >
                <span className="text-xs font-medium">{job.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{job.scheduleCron}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
