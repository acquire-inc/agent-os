import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "#/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-muted text-muted-foreground",
        outline: "border-border text-foreground",
        primary: "border-transparent bg-accent text-accent-foreground",
        success: "border-transparent bg-[color-mix(in_oklch,var(--color-success)_18%,transparent)] text-success",
        warning: "border-transparent bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] text-warning",
        danger: "border-transparent bg-[color-mix(in_oklch,var(--color-danger)_16%,transparent)] text-danger",
        info: "border-transparent bg-[color-mix(in_oklch,var(--color-info)_16%,transparent)] text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
