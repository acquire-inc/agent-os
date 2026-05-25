import {
  Activity,
  Boxes,
  BrainCircuit,
  CircleDollarSign,
  Cable,
  ClipboardCheck,
  LayoutGrid,
  Plug,
  Repeat,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Runs", icon: Activity },
  { to: "/jobs", label: "Jobs", icon: LayoutGrid },
  { to: "/agents", label: "Agents", icon: Boxes },
  { to: "/routines", label: "Routines", icon: Repeat },
  { to: "/skills", label: "Skills", icon: Sparkles },
  { to: "/mcps", label: "MCPs", icon: Cable },
  { to: "/knowledge", label: "Knowledge", icon: BrainCircuit },
  { to: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { to: "/cost", label: "Cost", icon: CircleDollarSign },
  { to: "/connections", label: "Connections", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
];
