import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Hexagon, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "#/components/ui/misc";
import { useApp } from "#/lib/app-context";
import { useAuth } from "#/lib/auth";
import { data } from "#/lib/data";
import { cn } from "#/lib/utils";
import { CompanySwitcher } from "./company-switcher";
import { NAV_GROUPS } from "./nav";
import { ThemeToggle } from "./theme-toggle";

const COLLAPSE_KEY = "aos-sidebar-collapsed";

export function SideNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { activeTenant } = useApp();
  const { user, signOut, demoMode } = useAuth();
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSE_KEY) === "1",
  );

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", activeTenant?.id],
    queryFn: () => data.approvals(activeTenant!.id),
    enabled: Boolean(activeTenant),
  });
  const openApprovals = approvals.filter((a) => a.status === "open").length;

  return (
    <nav
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Brand + collapse toggle */}
      <div className={cn("flex h-14 items-center border-b border-border px-3", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Hexagon className="size-4" fill="currentColor" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Agent OS</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
        </button>
      </div>

      {/* Company scope */}
      <div className={cn("border-b border-border p-3", collapsed && "flex justify-center")}>
        <CompanySwitcher collapsed={collapsed} />
      </div>

      {/* Nav groups */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {collapsed ? (
              gi > 0 && <div className="mx-2 mb-2 h-px bg-border/60" />
            ) : (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                const badge = item.to === "/approvals" && openApprovals > 0 ? openApprovals : null;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group flex items-center rounded-lg text-sm font-medium transition-colors",
                      collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="relative flex">
                      <item.icon
                        className={cn(
                          "size-[18px]",
                          active ? "text-accent-foreground" : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      {collapsed && badge && (
                        <span className="absolute -right-1.5 -top-1.5 size-2 rounded-full bg-warning ring-2 ring-sidebar" />
                      )}
                    </span>
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                    {!collapsed && badge && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer: user + theme */}
      <div className="border-t border-border p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void signOut()}
              title="Sign out"
              aria-label="Sign out"
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Avatar name={user?.name ?? user?.email} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <Avatar name={user?.name ?? user?.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{user?.name ?? "You"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>
              </div>
              <ThemeToggle />
              <button
                type="button"
                onClick={() => void signOut()}
                title="Sign out"
                aria-label="Sign out"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut className="size-[18px]" />
              </button>
            </div>
            {demoMode && (
              <div className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                Demo mode — sample data
              </div>
            )}
          </>
        )}
      </div>
    </nav>
  );
}
