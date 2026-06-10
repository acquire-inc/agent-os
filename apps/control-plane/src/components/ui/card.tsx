import type { HTMLAttributes, KeyboardEvent, MouseEvent } from "react";
import { cn } from "#/lib/utils";

// A Card with an onClick is an interactive control, so it must be reachable and
// activatable by keyboard — not just the mouse. When onClick is present we
// promote the div to role="button", make it focusable, and map Enter/Space to
// the same handler. Static cards (no onClick) are untouched.
export function Card({ className, onClick, onKeyDown, role, tabIndex, ...props }: HTMLAttributes<HTMLDivElement>) {
  const interactive = typeof onClick === "function";

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (interactive && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick?.(e as unknown as MouseEvent<HTMLDivElement>);
    }
    onKeyDown?.(e);
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-soft)]",
        interactive && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={role ?? (interactive ? "button" : undefined)}
      tabIndex={tabIndex ?? (interactive ? 0 : undefined)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold leading-none", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-5 pt-0", className)} {...props} />;
}
