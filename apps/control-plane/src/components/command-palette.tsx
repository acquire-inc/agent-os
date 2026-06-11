import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Boxes, Cable, CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NAV_ITEMS } from "#/components/shell/nav";
import { useApp } from "#/lib/app-context";
import { data } from "#/lib/data";
import { cn } from "#/lib/utils";

interface Item {
  id: string;
  label: string;
  group: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  hint?: string;
}

// Global command palette (⌘K) — the search box in the top bar opens this. Real,
// keyboard-driven navigation across pages, agents, and connectors so nothing in
// the chrome is a dead end.
export function CommandPalette() {
  const navigate = useNavigate();
  const { activeTenant } = useApp();
  const tenantId = activeTenant?.id;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: agents = [] } = useQuery({ queryKey: ["agents", tenantId], queryFn: () => data.agents(tenantId!), enabled: Boolean(tenantId) && open });
  const { data: mcps = [] } = useQuery({ queryKey: ["mcps", tenantId], queryFn: () => data.mcps(tenantId!), enabled: Boolean(tenantId) && open });

  // ⌘K / Ctrl-K toggles; "/" opens when not typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !isTyping(e))) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = NAV_ITEMS.map((n) => ({ id: `page-${n.to}`, label: n.label, group: "Pages", to: n.to, icon: n.icon, hint: "Go to" }));
    const agentItems: Item[] = agents.map((a) => ({ id: `agent-${a.id}`, label: a.name, group: "Agents", to: "/agents", icon: Boxes, hint: a.key }));
    const mcpItems: Item[] = mcps.map((m) => ({ id: `mcp-${m.id}`, label: m.name, group: "Connectors", to: "/mcps", icon: Cable, hint: m.status }));
    return [...pages, ...agentItems, ...mcpItems];
  }, [agents, mcps]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items.filter((i) => (i.label + " " + (i.hint ?? "")).toLowerCase().includes(q)).slice(0, 20);
  }, [items, query]);

  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results, active]);

  function go(item: Item) {
    setOpen(false);
    navigate({ to: item.to });
  }

  if (!open) return null;

  // Group results in display order.
  const groups: { name: string; items: Item[] }[] = [];
  for (const r of results) {
    const g = groups.find((x) => x.name === r.group) ?? (groups.push({ name: r.group, items: [] }), groups[groups.length - 1]!);
    g.items.push(r);
  }
  const flat = groups.flatMap((g) => g.items);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden />
      <div className="frosted animate-in relative w-full max-w-xl overflow-hidden rounded-2xl border border-border shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && flat[active]) { e.preventDefault(); go(flat[active]!); }
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search agents, connectors, pages…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:inline">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No matches.</p>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="mb-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.name}</p>
                {g.items.map((item) => {
                  const idx = flat.indexOf(item);
                  const isActive = idx === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseMove={() => setActive(idx)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                      )}
                    >
                      <item.icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint && <span className="shrink-0 truncate text-xs text-muted-foreground">{item.hint}</span>}
                      {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

// A button that looks like a search field and opens the palette. Replaces the
// dead input in the top bar.
export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
      className="flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="hidden shrink-0 rounded border border-border px-1.5 text-[10px] sm:inline">⌘K</kbd>
    </button>
  );
}
