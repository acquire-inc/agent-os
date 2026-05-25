import { forwardRef, type HTMLAttributes, type InputHTMLAttributes } from "react";
import { cn } from "#/lib/utils";
import { initials } from "#/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Separator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} {...props} />;
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground",
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}

const TONE: Record<string, string> = {
  running: "bg-info",
  scheduled: "bg-muted-foreground",
  pending: "bg-warning",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-danger",
  skipped: "bg-muted-foreground/60",
  connected: "bg-success",
  needs_reauth: "bg-warning",
  disconnected: "bg-muted-foreground/60",
  error: "bg-danger",
};

export function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2.5">
      {pulse && (
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", TONE[status] ?? "bg-muted-foreground")} />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", TONE[status] ?? "bg-muted-foreground")} />
    </span>
  );
}
