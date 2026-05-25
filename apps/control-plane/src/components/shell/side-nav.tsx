import { Link, useRouterState } from "@tanstack/react-router";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { useQuery } from "@tanstack/react-query";
import { cn } from "#/lib/utils";
import { NAV_ITEMS } from "./nav";

export function SideNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { activeTenant } = useApp();

  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", activeTenant?.id],
    queryFn: () => data.approvals(activeTenant!.id),
    enabled: Boolean(activeTenant),
  });
  const openApprovals = approvals.filter((a) => a.status === "open").length;

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-3">
      {NAV_ITEMS.map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        const badge = item.to === "/approvals" && openApprovals > 0 ? openApprovals : null;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-[18px]", active ? "text-accent-foreground" : "text-muted-foreground group-hover:text-foreground")} />
            <span className="flex-1">{item.label}</span>
            {badge && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
