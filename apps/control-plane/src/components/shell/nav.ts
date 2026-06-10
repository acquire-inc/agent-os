import {
  Activity,
  Boxes,
  BrainCircuit,
  CircleDollarSign,
  Cable,
  ClipboardCheck,
  Cpu,
  Gauge,
  LayoutGrid,
  Plug,
  Repeat,
  Settings,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Grouped by intent so the sidebar reads as three jobs-to-be-done rather than a
// flat list of 14 links: watch the fleet, build it, govern it.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { to: "/", label: "Runs", icon: Activity },
      { to: "/performance", label: "Dashboard", icon: Gauge },
      { to: "/jobs", label: "Jobs", icon: LayoutGrid },
      { to: "/approvals", label: "Approvals", icon: ClipboardCheck },
    ],
  },
  {
    label: "Build",
    items: [
      { to: "/agents", label: "Agents", icon: Boxes },
      { to: "/architect", label: "Architect", icon: Wand2 },
      { to: "/routines", label: "Routines", icon: Repeat },
      { to: "/skills", label: "Skills", icon: Sparkles },
      { to: "/mcps", label: "MCPs", icon: Cable },
      { to: "/knowledge", label: "Knowledge", icon: BrainCircuit },
      { to: "/connections", label: "Connections", icon: Plug },
    ],
  },
  {
    label: "Govern",
    items: [
      { to: "/cost", label: "Cost", icon: CircleDollarSign },
      { to: "/model-routing", label: "Model routing", icon: Cpu },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Flat list retained for any consumer that just needs every destination.
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
