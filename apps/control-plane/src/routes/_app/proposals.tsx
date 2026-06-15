import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Pause, RefreshCw, XCircle } from "lucide-react";
import { EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Separator } from "#/components/ui/misc";
import {
  hasAdminKey,
  improvementProposals as improvementApi,
  managerProposals as managerApi,
  type ImprovementProposalRow,
  type ManagerProposalRow,
} from "#/lib/api";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { agentMap } from "#/lib/helpers";
import { relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/proposals")({ component: ProposalsPage });

function ProposalsPage() {
  const { activeTenant } = useApp();
  const tenantId = activeTenant?.id;
  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });
  const amap = agentMap(agents);

  if (!hasAdminKey()) {
    return (
      <Page>
        <PageHeader
          title="Pending proposals"
          description="Self-improvement and autonomous-manager proposals queued for your review."
        />
        <Card className="max-w-2xl p-5">
          <p className="text-sm text-muted-foreground">
            Paste an admin API key on Settings → API Connection to load proposals.
          </p>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Pending proposals"
        description="Self-improvement and autonomous-manager proposals queued for your review."
      />
      <Tabs defaultValue="improvement">
        <TabsList className="mb-4">
          <TabsTrigger value="improvement">Prompt improvements (V2 P4)</TabsTrigger>
          <TabsTrigger value="manager">Manager actions (V2 P8)</TabsTrigger>
        </TabsList>
        <TabsContent value="improvement">
          <ImprovementProposalsList amap={amap} />
        </TabsContent>
        <TabsContent value="manager">
          <ManagerProposalsList amap={amap} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function ImprovementProposalsList({ amap }: { amap: Map<string, { name: string; key: string }> }) {
  const qc = useQueryClient();
  const { data: payload, isLoading, error, refetch } = useQuery({
    queryKey: ["improvementProposals"],
    queryFn: () => improvementApi.list("pending"),
  });
  // CR-02: cant-fail / requires-human-approval proposals demand the operator
  // tick a confirmation checkbox in the same card before Apply works. We pass
  // confirmed through to the mutation so it can set the x-confirm-cantfail
  // header — the API enforces it server-side too (412 when missing).
  const decide = useMutation({
    mutationFn: ({ id, decision, confirmed }: { id: string; decision: "apply" | "reject"; confirmed?: boolean }) =>
      improvementApi.decide(id, decision, { confirmCantFail: confirmed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["improvementProposals"] }),
  });

  if (isLoading) return <Card className="p-5"><p className="text-sm text-muted-foreground">Loading…</p></Card>;
  if (error) return <Card className="p-5"><p className="text-sm text-destructive">{(error as Error).message}</p></Card>;
  const rows = payload?.proposals ?? [];

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>{rows.length} pending</SectionLabel>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8" />}
          title="No pending improvement proposals"
          description="The self-improvement loop only proposes when recurring lessons land. New ones will show up here."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <ImprovementProposalCard
              key={p.id}
              proposal={p}
              agentLabel={amap.get(p.agentId)?.name ?? p.agentId}
              pending={decide.isPending && decide.variables?.id === p.id}
              onDecide={(decision, confirmed) => decide.mutate({ id: p.id, decision, confirmed })}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ImprovementProposalCard({
  proposal,
  agentLabel,
  pending,
  onDecide,
}: {
  proposal: ImprovementProposalRow;
  agentLabel: string;
  pending: boolean;
  onDecide: (decision: "apply" | "reject", confirmed?: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // CR-02 UI gate: cant-fail prompt rewrites cannot be one-click applies.
  // Apply stays disabled until the operator ticks the confirmation box; the
  // tick also flips the x-confirm-cantfail header on send. Non-cant-fail
  // proposals keep the normal one-click flow.
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirm = proposal.requiresHumanApproval;
  const applyDisabled = pending || (needsConfirm && !confirmed);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold leading-tight">{agentLabel}</p>
          <p className="text-xs text-muted-foreground">
            {proposal.kind} · {relativeTime(proposal.createdAt)} · sample size {proposal.sampleSize}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {proposal.requiresHumanApproval && (
            <Badge variant="warning" title="Cant-fail agent — operator must approve">human required</Badge>
          )}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onDecide("reject")}>
            <XCircle className="size-4" /> Reject
          </Button>
          <Button size="sm" disabled={applyDisabled} onClick={() => onDecide("apply", confirmed)}>
            <CheckCircle2 className="size-4" /> Apply
          </Button>
        </div>
      </div>
      <Separator className="my-3" />
      <p className="text-sm">{proposal.rationale}</p>
      {needsConfirm && (
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="size-3.5"
          />
          I confirm this is a cant-fail prompt rewrite and I want to apply it (sends
          <code className="mx-1">x-confirm-cantfail: yes</code>).
        </label>
      )}
      <button
        type="button"
        className="mt-3 text-xs text-muted-foreground underline"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? "Hide proposed prompt" : "Show proposed prompt"}
      </button>
      {expanded && proposal.proposedPrompt && (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
          {proposal.proposedPrompt}
        </pre>
      )}
    </Card>
  );
}

function ManagerProposalsList({ amap }: { amap: Map<string, { name: string; key: string }> }) {
  const qc = useQueryClient();
  const { data: payload, isLoading, error, refetch } = useQuery({
    queryKey: ["managerProposals"],
    queryFn: () => managerApi.list("pending"),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "apply" | "reject" }) => managerApi.decide(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["managerProposals"] }),
  });

  if (isLoading) return <Card className="p-5"><p className="text-sm text-muted-foreground">Loading…</p></Card>;
  if (error) return <Card className="p-5"><p className="text-sm text-destructive">{(error as Error).message}</p></Card>;
  const rows = payload?.proposals ?? [];

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>{rows.length} pending</SectionLabel>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-8" />}
          title="No pending manager proposals"
          description="The autonomous manager only proposes when an agent crosses a threshold (low success rate, budget hog, long pause)."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <ManagerProposalCard
              key={p.id}
              proposal={p}
              agentLabel={amap.get(p.agentId)?.name ?? p.agentId}
              pending={decide.isPending && decide.variables?.id === p.id}
              onDecide={(decision) => decide.mutate({ id: p.id, decision })}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ManagerProposalCard({
  proposal,
  agentLabel,
  pending,
  onDecide,
}: {
  proposal: ManagerProposalRow;
  agentLabel: string;
  pending: boolean;
  onDecide: (decision: "apply" | "reject") => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pause className="size-4 text-muted-foreground" />
          <div>
            <p className="font-semibold leading-tight">{agentLabel}</p>
            <p className="text-xs text-muted-foreground">
              {proposal.kind} · {relativeTime(proposal.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onDecide("reject")}>
            <XCircle className="size-4" /> Reject
          </Button>
          <Button size="sm" disabled={pending} onClick={() => onDecide("apply")}>
            <CheckCircle2 className="size-4" /> {proposal.kind === "pause" ? "Pause" : "Retire"}
          </Button>
        </div>
      </div>
      <Separator className="my-3" />
      <p className="text-sm">{proposal.rationale}</p>
    </Card>
  );
}
