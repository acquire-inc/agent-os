import { useQuery } from "@tanstack/react-query";
import type { Agent, Run } from "@agent-os/shared";
import { Badge } from "#/components/ui/badge";
import { Drawer } from "#/components/ui/drawer";
import { Separator, StatusDot } from "#/components/ui/misc";
import { data } from "#/lib/data";
import { RUN_STATUS_LABEL, statusBadgeVariant } from "#/lib/helpers";
import { formatNumber, formatUsd, relativeTime } from "#/lib/utils";

const KIND_COLOR: Record<string, string> = {
  start: "text-info",
  tool: "text-foreground",
  propose: "text-warning",
  summary: "text-success",
};

export function RunDetail({ run, agent, onClose }: { run: Run; agent?: Agent; onClose: () => void }) {
  const { data: activity = [] } = useQuery({
    queryKey: ["run-activity", run.id],
    queryFn: () => data.runActivity(run.id),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <StatusDot status={run.status} pulse={run.status === "running"} />
          <div>
            <p className="text-sm font-semibold leading-tight">{agent?.name ?? "Run"}</p>
            <p className="text-xs text-muted-foreground">{run.triggerSource} · {relativeTime(run.startedAt ?? run.scheduledFor)}</p>
          </div>
          <Badge variant={statusBadgeVariant(run.status)} className="ml-2">{RUN_STATUS_LABEL[run.status]}</Badge>
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Tokens in" value={formatNumber(run.tokensIn)} />
        <Metric label="Tokens out" value={formatNumber(run.tokensOut)} />
        <Metric label="Cost" value={run.costUsd > 0 ? formatUsd(run.costUsd) : "—"} />
      </div>

      {run.summary && (
        <div className="mt-5">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</h3>
          <p className="rounded-lg bg-muted px-3.5 py-3 text-sm">{run.summary}</p>
        </div>
      )}

      <div className="mt-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity log</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ol className="relative ml-1 border-l border-border">
            {activity.map((ev) => (
              <li key={ev.id} className="relative mb-4 pl-5 last:mb-0">
                <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-border" />
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${KIND_COLOR[ev.kind] ?? "text-muted-foreground"}`}>{ev.kind}</span>
                  <span className="text-xs text-muted-foreground">{relativeTime(ev.ts)}</span>
                </div>
                <p className="mt-0.5 font-mono text-[13px] leading-snug">{ev.message}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {run.sdkSessionId && (
        <>
          <Separator className="my-5" />
          <p className="font-mono text-xs text-muted-foreground">session: {run.sdkSessionId}</p>
        </>
      )}
    </Drawer>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}
