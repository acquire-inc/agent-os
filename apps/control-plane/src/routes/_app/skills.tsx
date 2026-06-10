import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, Github, Globe, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Agent, Skill } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { CardGridSkeleton, EmptyState, Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Drawer } from "#/components/ui/drawer";
import { Separator } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { hasAllTags, inProjectScope, matchesSearch } from "#/lib/helpers";

export const Route = createFileRoute("/_app/skills")({ component: SkillsPage });

const SORTS = [
  { value: "name", label: "Name" },
  { value: "used", label: "Most used" },
  { value: "version", label: "Version" },
];

const SOURCES = [
  { value: "all", label: "All sources" },
  { value: "github", label: "GitHub" },
  { value: "builtin", label: "Built-in" },
  { value: "custom", label: "Custom" },
];

function SkillsPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("name");
  const [selected, setSelected] = useState<Skill | null>(null);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ["skills", tenantId],
    queryFn: () => data.skills(tenantId!),
    enabled: Boolean(tenantId),
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });

  const usageByKey = new Map<string, number>();
  for (const agent of agents) {
    for (const key of agent.skillKeys ?? []) {
      usageByKey.set(key, (usageByKey.get(key) ?? 0) + 1);
    }
  }

  const allTags = [...new Set(skills.flatMap((s) => s.tags ?? []))].sort();

  const filtered = skills
    .filter((s) => inProjectScope(s.projectId, activeProjectId))
    .filter((s) => f.filters.source === "all" || s.source === f.filters.source)
    .filter((s) => hasAllTags(s.tags, f.filters.tags))
    .filter((s) => matchesSearch([s.name, s.key, s.description], f.filters.search));

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "used") return (usageByKey.get(b.key) ?? 0) - (usageByKey.get(a.key) ?? 0);
    if (f.filters.sort === "version") return b.version.localeCompare(a.version);
    return a.name.localeCompare(b.name);
  });

  return (
    <Page>
      <PageHeader
        title="Skills"
        description="Reusable capabilities your agents apply — and know when to apply."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm">
              <Github className="size-4" /> Sync from GitHub
            </Button>
            <Button size="sm">
              <Plus className="size-4" /> New skill
            </Button>
          </div>
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
          searchPlaceholder="Search skills…"
        />
      </div>

      {isLoading ? (
        <CardGridSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-8" />}
          title="No skills match your filters"
          description="Try clearing filters or switching project scope."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              agentCount={usageByKey.get(s.key) ?? 0}
              onClick={() => setSelected(s)}
            />
          ))}
        </div>
      )}

      {selected && (
        <SkillDrawer
          skill={selected}
          agentCount={usageByKey.get(selected.key) ?? 0}
          onClose={() => setSelected(null)}
        />
      )}
    </Page>
  );
}

function SourceBadge({ source }: { source: Skill["source"] }) {
  if (source === "github") {
    return (
      <Badge variant="outline">
        <Github className="size-3" /> GitHub
      </Badge>
    );
  }
  if (source === "builtin") {
    return <Badge variant="primary">built-in</Badge>;
  }
  return <Badge>custom</Badge>;
}

function SkillCard({
  skill,
  agentCount,
  onClick,
}: {
  skill: Skill;
  agentCount: number;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer p-5 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-pop)]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold leading-tight">{skill.name}</p>
        <SourceBadge source={skill.source} />
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {skill.key} · v{skill.version}
      </p>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{skill.description}</p>
      {(skill.tags ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(skill.tags ?? []).slice(0, 3).map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      )}
      <Separator className="my-3" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Globe className="size-3" />
          {skill.scope}
        </span>
        <span>{agentCount} agents</span>
      </div>
    </Card>
  );
}

function SkillDrawer({
  skill,
  agentCount,
  onClose,
}: {
  skill: Skill;
  agentCount: number;
  onClose: () => void;
}) {
  return (
    <Drawer open onClose={onClose} width="max-w-xl" title={<p className="font-semibold">{skill.name}</p>}>
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">{skill.description}</p>

        <div className="grid grid-cols-2 gap-3">
          <DrawerField label="Version" value={`v${skill.version}`} />
          <DrawerField label="Source" value={skill.source} />
          <DrawerField label="Scope" value={skill.scope} />
          <DrawerField label="Agents using this" value={String(agentCount)} />
        </div>

        {skill.repoPath && (
          <div className="rounded-lg border border-border bg-subtle px-3 py-2.5">
            <p className="mb-1 text-xs text-muted-foreground">Repository path</p>
            <span className="inline-flex items-center gap-1.5 font-mono text-sm">
              <GitBranch className="size-3.5 text-muted-foreground" />
              {skill.repoPath}
            </span>
          </div>
        )}

        {(skill.tags ?? []).length > 0 && (
          <div>
            <SubLabel>Tags</SubLabel>
            <div className="flex flex-wrap gap-1.5">
              {(skill.tags ?? []).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </div>
        )}

        <Separator />

        <Button variant="secondary" size="sm" disabled title="Coming soon">
          Attach to agent
        </Button>
      </div>
    </Drawer>
  );
}

function DrawerField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}
