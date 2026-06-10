import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Card } from "#/components/ui/card";
import { cn } from "#/lib/utils";

export interface RangeOption {
  value: number;
  label: string;
}

// Quick date-range presets, lifted from the reference dashboards. `value` is a
// day-count window the page uses to fetch/aggregate.
export const PERF_RANGES: RangeOption[] = [
  { value: 1, label: "Today" },
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

export function DateRangeChips({
  value,
  onChange,
  options = PERF_RANGES,
}: {
  value: number;
  onChange: (v: number) => void;
  options?: RangeOption[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date range">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Period-over-period change pill. `goodDirection` flips the color semantics for
// metrics where a decrease is the win (cost, failures): green when the change
// is in the good direction, red otherwise.
export function DeltaPill({
  pct,
  goodDirection = "up",
}: {
  pct: number | null;
  goodDirection?: "up" | "down";
}) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = goodDirection === "up" ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        good ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
      )}
    >
      <Icon className="size-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function Sparkline({ data, color = "var(--color-primary)" }: { data: number[]; color?: string }) {
  const id = useId().replace(/:/g, "");
  if (data.length < 2) return <div className="h-9" />;
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          fill={`url(#spark-${id})`}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// KPI hero card: uppercase label · delta pill · big value · sparkline ·
// methodology note (the "View calculation" transparency the references lean on).
export function KpiCard({
  label,
  value,
  deltaPct,
  goodDirection = "up",
  spark,
  sparkColor,
  note,
}: {
  label: string;
  value: ReactNode;
  deltaPct?: number | null;
  goodDirection?: "up" | "down";
  spark?: number[];
  sparkColor?: string;
  note?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <DeltaPill pct={deltaPct ?? null} goodDirection={goodDirection} />
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {spark && spark.length > 1 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={spark} color={sparkColor} />
        </div>
      )}
      {note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </Card>
  );
}

// Section heading with a left accent bar, matching the "Revenue & profitability"
// treatment in the reference UI.
export function MetricSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-primary" />
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}
