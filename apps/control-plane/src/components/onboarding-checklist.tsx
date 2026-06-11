import { Link } from "@tanstack/react-router";
import { Cable, Check, Radio, Rocket, X } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { userAgents } from "#/lib/agent-store";
import { statusOverrides, userMcps } from "#/lib/connector-store";
import { cn } from "#/lib/utils";

const DISMISS_KEY = "aos-onboarding-dismissed";
const ACTIVITY_VIEWED_KEY = "aos-onboarding-activity-viewed";

function flag(key: string): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(key) === "1";
}

// Call from the Activity page so step 3 completes once the operator has seen the
// live stream.
export function markActivityViewed(): void {
  try {
    localStorage.setItem(ACTIVITY_VIEWED_KEY, "1");
  } catch {
    /* non-fatal */
  }
}

interface Step {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  to: string;
  cta: string;
  icon: typeof Rocket;
}

// Activation checklist — the zero-to-value path. Completion reflects real
// operator actions (deployed an agent, connected a tool, watched the stream),
// so it doubles as a first-run guide and a "is this tenant activated" signal.
export function OnboardingChecklist({ tenantId }: { tenantId: string }) {
  const [dismissed, setDismissed] = useState(() => flag(DISMISS_KEY));
  if (dismissed) return null;

  const deployed = userAgents(tenantId).length > 0;
  const connected = userMcps(tenantId).length > 0 || Object.keys(statusOverrides(tenantId)).length > 0;
  const watched = flag(ACTIVITY_VIEWED_KEY);

  const steps: Step[] = [
    { key: "deploy", label: "Deploy your first agent", detail: "Pick a template — it lands in propose mode for you to tune.", done: deployed, to: "/agents", cta: "Deploy", icon: Rocket },
    { key: "connect", label: "Connect a tool", detail: "Give an agent active access to Slack, your CRM, and more.", done: connected, to: "/mcps", cta: "Connect", icon: Cable },
    { key: "watch", label: "Watch it work", detail: "See everything your agents do across your tools, live.", done: watched, to: "/activity", cta: "Open", icon: Radio },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* non-fatal */
    }
    setDismissed(true);
  }

  return (
    <Card className="relative mb-5 overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_oklch,var(--color-primary)_8%,transparent),transparent)]" />
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>

      <div className="relative">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{allDone ? "You're all set" : "Get started"}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{doneCount}/{steps.length}</span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {allDone ? "Your workspace is live. Dismiss this whenever you like." : "Three steps to a working agent fleet."}
        </p>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={cn(
                "flex flex-col rounded-xl border p-3.5",
                s.done ? "border-success/30 bg-success/5" : "border-border bg-card",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    s.done ? "bg-success text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="text-sm font-medium">{s.label}</span>
              </div>
              <p className="mt-1.5 flex-1 text-xs text-muted-foreground">{s.detail}</p>
              <Link to={s.to} className={cn(buttonVariants({ variant: s.done ? "ghost" : "secondary", size: "sm" }), "mt-3 w-full")}>
                <s.icon className="size-3.5" />
                {s.done ? "Review" : s.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
