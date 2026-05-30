// /architect — plain-English → N proposed agents → review → seed.
// Spec: docs/specs/agent-architect.md
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, ChevronRight, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Separator } from "#/components/ui/misc";
import { ApiError, architect, hasAdminKey, type Blueprint } from "#/lib/api";

export const Route = createFileRoute("/_app/architect")({ component: ArchitectPage });

const EXAMPLES = [
  "create my marketing team for Meta ads",
  "build a finance ops trio: AR aging watcher, cash position monitor, and a weekly margin recap",
  "give me a sales follow-up team for inbound leads from Close, with a follow-up SLA monitor",
  "I run a SaaS — design a churn-defense team that watches usage drops, drafts saves, and flags expansion fits",
];

function ArchitectPage() {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [active, setActive] = useState<Blueprint | null>(null);
  const noKey = !hasAdminKey();

  const list = useQuery({
    queryKey: ["architect", "blueprints"],
    queryFn: () => architect.list().then((r) => r.blueprints),
    enabled: !noKey,
  });

  const propose = useMutation({
    mutationFn: () => architect.propose({ prompt }),
    onSuccess: (r) => {
      setActive(r.blueprint);
      setPrompt("");
      qc.invalidateQueries({ queryKey: ["architect", "blueprints"] });
    },
  });

  const seed = useMutation({
    mutationFn: (id: string) => architect.seed(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["architect", "blueprints"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      if (active) setActive({ ...active, status: "seeded" });
    },
  });

  return (
    <Page>
      <PageHeader
        title="Architect"
        description="Describe a team in plain English. The Architect proposes a coherent set of agents — all start at autonomy=propose and disabled until you dry-run them."
        actions={
          <Badge variant="outline" className="text-xs">
            <Sparkles className="size-3.5" /> Powered by Hermes 4 405B
          </Badge>
        }
      />

      {noKey && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5 p-4">
          <p className="flex items-center gap-2 text-sm">
            <AlertCircle className="size-4 text-amber-500" />
            Paste an admin API key on <a href="/settings" className="underline">/settings</a> to use the Architect.
          </p>
        </Card>
      )}

      <Card className="mb-6 p-4">
        <SectionLabel>Describe the team</SectionLabel>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='e.g. "create my marketing team for Meta ads"'
          rows={3}
          className="w-full rounded-md border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          disabled={noKey || propose.isPending}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
              disabled={noKey || propose.isPending}
            >
              {ex}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Architect refuses to assemble can't-fail agents. They land disabled until you approve the first dry-run.
          </p>
          <Button
            onClick={() => propose.mutate()}
            disabled={noKey || !prompt.trim() || propose.isPending}
          >
            {propose.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            Propose team
          </Button>
        </div>
        {propose.isError && <ProposeError err={propose.error as Error} />}
      </Card>

      {active && (
        <BlueprintCard
          blueprint={active}
          onSeed={() => seed.mutate(active.id)}
          seeding={seed.isPending}
          seeded={active.status === "seeded"}
        />
      )}

      <SectionLabel>Recent blueprints</SectionLabel>
      {!list.data?.length && !list.isLoading && (
        <EmptyState
          icon={<Wand2 className="size-6" />}
          title="No blueprints yet"
          description="Describe a team above to propose your first."
        />
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(list.data ?? [])
          .filter((bp) => bp.id !== active?.id)
          .map((bp) => (
            <Card
              key={bp.id}
              onClick={() => setActive(bp)}
              className="cursor-pointer p-4 transition hover:border-primary/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{bp.teamName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{bp.prompt}</p>
                </div>
                <Badge variant={bp.status === "seeded" ? "success" : "info"}>{bp.status}</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{bp.agents.length} agents</span>
                <span>{new Date(bp.createdAt).toLocaleString()}</span>
              </div>
            </Card>
          ))}
      </div>
    </Page>
  );
}

function ProposeError({ err }: { err: Error }) {
  const message = err instanceof ApiError && err.status === 501
    ? "Architect not configured on the API — set OPENROUTER_API_KEY and restart."
    : err.message;
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
      <AlertCircle className="size-4" />
      {message}
    </p>
  );
}

function BlueprintCard({
  blueprint,
  onSeed,
  seeding,
  seeded,
}: {
  blueprint: Blueprint;
  onSeed: () => void;
  seeding: boolean;
  seeded: boolean;
}) {
  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Proposed team</p>
          <h2 className="mt-1 text-lg font-semibold">{blueprint.teamName}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{blueprint.rationale}</p>
        </div>
        <Button onClick={onSeed} disabled={seeded || seeding}>
          {seeding ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}
          {seeded ? "Seeded" : "Seed all (disabled until dry-run)"}
        </Button>
      </div>

      {blueprint.warnings.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="mb-1 text-xs font-semibold uppercase text-amber-600">Warnings</p>
          <ul className="space-y-1 text-xs text-amber-700/90 dark:text-amber-200/90">
            {blueprint.warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </div>
      )}

      <Separator className="my-4" />

      <SectionLabel>Agents ({blueprint.agents.length})</SectionLabel>
      <div className="space-y-3">
        {blueprint.agents.map((a) => (
          <Card key={a.key} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{a.name} <span className="text-xs text-muted-foreground">— {a.key}</span></p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge variant="info" className="text-xs">{a.model}</Badge>
                  <Badge variant="outline" className="text-xs">autonomy: {a.autonomy}</Badge>
                  <Badge variant="outline" className="text-xs">budget: ${a.budgetCapUsd}</Badge>
                  {a.cron && <Badge variant="outline" className="text-xs">cron: {a.cron.schedule}</Badge>}
                  {a.enabled === false && <Badge variant="outline" className="text-xs">enabled: false</Badge>}
                </div>
              </div>
            </div>
            <pre className="mt-3 max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-snug text-muted-foreground">
              {a.systemPrompt}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {a.skills.length > 0 && <span>skills: {a.skills.map((s) => s.key).join(", ")}</span>}
              {a.mcpNames.length > 0 && <span>mcps: {a.mcpNames.join(", ")}</span>}
            </div>
          </Card>
        ))}
      </div>

      {(blueprint.proposedSkills.length > 0 || blueprint.proposedMcps.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {blueprint.proposedSkills.length > 0 && (
            <div className="rounded-md border border-dashed border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Proposed new skills</p>
              <ul className="space-y-1 text-xs">
                {blueprint.proposedSkills.map((s) => (
                  <li key={s.key}><span className="font-mono">{s.key}</span> — {s.why}</li>
                ))}
              </ul>
            </div>
          )}
          {blueprint.proposedMcps.length > 0 && (
            <div className="rounded-md border border-dashed border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Proposed new MCPs</p>
              <ul className="space-y-1 text-xs">
                {blueprint.proposedMcps.map((m) => (
                  <li key={m.name}><span className="font-mono">{m.name}</span> — {m.why}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-[11px] text-muted-foreground">
        Cost: ${blueprint.llmCostUsd.toFixed(4)} • LLM: {blueprint.llmModel} • Created {new Date(blueprint.createdAt).toLocaleString()}
      </div>
    </Card>
  );
}
