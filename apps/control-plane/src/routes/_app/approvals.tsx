import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, ClipboardCheck, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import type { Agent, Approval } from "@agent-os/shared";
import { FilterBar, useListFilters } from "#/components/shell/filter-bar";
import { CardGridSkeleton, EmptyState, Page, PageHeader, SectionLabel } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Avatar, Separator } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { approvalDecision, decideApproval } from "#/lib/approval-store";
import { useAuth } from "#/lib/auth";
import { data } from "#/lib/data";
import { agentInProject, agentMap, matchesSearch } from "#/lib/helpers";
import { relativeTime } from "#/lib/utils";

export const Route = createFileRoute("/_app/approvals")({ component: ApprovalsPage });

const SOURCES = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "decided", label: "Decided" },
  { value: "expired", label: "Expired" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "Newest" },
  { value: "agent", label: "Agent" },
];

function ApprovalsPage() {
  const { activeTenant, activeProjectId } = useApp();
  const tenantId = activeTenant?.id;
  const f = useListFilters("recent");
  const { user } = useAuth();
  const qc = useQueryClient();

  const decide = useMutation({
    mutationFn: async ({ id, key }: { id: string; key: string }) => {
      if (!tenantId) return;
      decideApproval(tenantId, id, key, user?.name ?? user?.email ?? "operator");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals", tenantId] }),
  });

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ["approvals", tenantId],
    queryFn: () => data.approvals(tenantId!),
    enabled: Boolean(tenantId),
  });
  const { data: agents = [] } = useQuery({
    queryKey: ["agents", tenantId],
    queryFn: () => data.agents(tenantId!),
    enabled: Boolean(tenantId),
  });

  const amap = agentMap(agents);

  const filtered = approvals.filter((a) => {
    const agent = amap.get(a.agentId);
    if (!agentInProject(agent, activeProjectId)) return false;
    if (f.filters.source !== "all" && a.status !== f.filters.source) return false;
    const agentName = agent?.name ?? "";
    return matchesSearch([a.context, a.proposedAction, agentName], f.filters.search);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (f.filters.sort === "agent") {
      const an = amap.get(a.agentId)?.name ?? "";
      const bn = amap.get(b.agentId)?.name ?? "";
      return an.localeCompare(bn);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });

  const openItems = sorted.filter((a) => a.status === "open");
  const resolvedItems = sorted.filter((a) => a.status !== "open");

  const showOpen = f.filters.source === "all" || f.filters.source === "open";
  const showResolved = f.filters.source === "all" || f.filters.source === "decided" || f.filters.source === "expired";

  const totalVisible =
    (showOpen ? openItems.length : 0) + (showResolved ? resolvedItems.length : 0);

  return (
    <Page>
      <PageHeader
        title="Approvals"
        description="The multiple-choice inbox. Every decision becomes 1A / 1B / 2C — answerable here, Slack, or Telegram."
      />

      {/* Mirror notice */}
      <Card className="mb-5 p-3">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <MessageSquare className="size-4 shrink-0" />
          <span>Mirrored to Slack #approvals and Telegram. Answer from anywhere.</span>
        </div>
      </Card>

      <div className="mb-4">
        <FilterBar
          filters={f.filters}
          onSearch={f.setSearch}
          onToggleTag={f.toggleTag}
          onSource={f.setSource}
          onSort={f.setSort}
          availableTags={[]}
          sources={SOURCES}
          sortOptions={SORT_OPTIONS}
          searchPlaceholder="Search approvals…"
        />
      </div>

      {isLoading ? (
        <CardGridSkeleton count={4} columns="" />
      ) : totalVisible === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-8" />}
          title="Inbox zero"
          description="No decisions waiting. Your agents are running autonomously."
        />
      ) : (
        <div className="space-y-8">
          {showOpen && openItems.length > 0 && (
            <section>
              <SectionLabel>Needs your decision · {openItems.length}</SectionLabel>
              <div className="space-y-4">
                {openItems.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    agentName={amap.get(approval.agentId)?.name ?? "Unknown"}
                    chosenKey={tenantId ? approvalDecision(tenantId, approval.id)?.choiceKey : undefined}
                    onChoose={(key) => decide.mutate({ id: approval.id, key })}
                  />
                ))}
              </div>
            </section>
          )}

          {showResolved && resolvedItems.length > 0 && (
            <section className="opacity-80">
              <SectionLabel>Resolved · {resolvedItems.length}</SectionLabel>
              <div className="space-y-4">
                {resolvedItems.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    agentName={amap.get(approval.agentId)?.name ?? "Unknown"}
                    chosenKey={tenantId ? approvalDecision(tenantId, approval.id)?.choiceKey : undefined}
                    onChoose={(key) => decide.mutate({ id: approval.id, key })}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}

function statusBadgeVariant(status: Approval["status"]): "warning" | "success" | "default" {
  if (status === "open") return "warning";
  if (status === "decided") return "success";
  return "default";
}

function optionButtonVariant(
  index: number,
  optionKey: string,
): "primary" | "secondary" | "outline" {
  const lower = optionKey.toLowerCase();
  if (lower === "none" || lower === "skip" || lower === "cancel") return "outline";
  if (index === 0) return "primary";
  return "secondary";
}

function ApprovalCard({
  approval,
  agentName,
  chosenKey,
  onChoose,
}: {
  approval: Approval;
  agentName: string;
  chosenKey: string | undefined;
  onChoose: (key: string) => void;
}) {
  const isOpen = approval.status === "open";
  const isAnswered = Boolean(chosenKey);
  const firstOption = approval.options[0];

  return (
    <Card className="p-5">
      {/* Top row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Avatar name={agentName} />
          <span className="font-semibold leading-tight">{agentName}</span>
          <span className="text-xs text-muted-foreground">{relativeTime(approval.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          {isAnswered && isOpen && (
            <Badge variant="success">
              <Check className="size-3" />
              Answered: {chosenKey}
            </Badge>
          )}
          {/* V2 P6: critic peer-approval surface. Auto-approved by quorum
              gets a distinct badge so an operator can see at a glance
              that the proposal cleared the trusted-agent layer instead
              of a human seat. */}
          {approval.decidedVia === "critic_quorum" && (
            <Badge variant="primary" title="Auto-approved by trusted-agent quorum (V2 P6)">
              critic quorum
            </Badge>
          )}
          {approval.escalated && (
            <Badge variant="warning" title="A trusted-agent critic rejected this proposal — needs a human decision">
              peer-flagged
            </Badge>
          )}
          <Badge variant={statusBadgeVariant(approval.status)}>{approval.status}</Badge>
        </div>
      </div>

      {/* Context */}
      <p className="mt-3 text-sm text-foreground">{approval.context}</p>

      {/* Proposed action */}
      <div className="mt-3 rounded-lg bg-muted p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Proposed action
        </p>
        <p className="text-sm">{approval.proposedAction}</p>
      </div>

      <Separator className="my-3" />

      {/* Options */}
      {isOpen ? (
        <>
          <div className="flex flex-wrap gap-2">
            {approval.options.map((opt, i) => (
              <Button
                key={opt.key}
                variant={optionButtonVariant(i, opt.key)}
                size="sm"
                disabled={isAnswered}
                onClick={() => onChoose(opt.key)}
                className={chosenKey === opt.key ? "ring-2 ring-primary/60" : ""}
              >
                {opt.key} · {opt.label}
              </Button>
            ))}
          </div>

          {!isAnswered && firstOption && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Send className="size-3 shrink-0" />
              Reply &lsquo;{firstOption.key}&rsquo; in Slack to action remotely.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {approval.options.map((opt) => (
            <Badge key={opt.key} variant={chosenKey === opt.key ? "success" : "default"}>
              {chosenKey === opt.key && <Check className="size-3" />}
              {opt.key} · {opt.label}
            </Badge>
          ))}
          {approval.decidedBy && (
            <span className="text-xs text-muted-foreground">
              {approval.decidedVia === "critic_quorum" ? "Auto-approved by critic quorum" : `Decided by ${approval.decidedBy}`}
              {approval.decidedAt ? ` · ${relativeTime(approval.decidedAt)}` : ""}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
