import {
  Activity,
  BarChart3,
  ClipboardList,
  LayoutGrid,
  ListPlus,
  Settings,
  Sparkles,
  Table2,
  TrendingUp,
  Zap,
} from "lucide-react";

import type { FactoryRole } from "@/lib/factory/context";

export interface NavItem {
  /** Path appended to /factory/<slug> — "" is the dashboard itself. */
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  roles: FactoryRole[];
  /** False until the module is actually built; rendered as "Soon". */
  ready: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

const ALL: FactoryRole[] = [
  "super_admin",
  "admin",
  "manager",
  "supervisor",
  "operator",
];
const SUPERVISOR_UP: FactoryRole[] = [
  "super_admin",
  "admin",
  "manager",
  "supervisor",
];
const MANAGER_UP: FactoryRole[] = ["super_admin", "admin", "manager"];

export const FACTORY_NAV: NavSection[] = [
  {
    label: "Production",
    items: [
      { href: "", label: "Dashboard", icon: LayoutGrid, roles: SUPERVISOR_UP, ready: true },
      { href: "/pipeline", label: "Pipeline", icon: Activity, roles: ALL, ready: true },
      { href: "/log", label: "Shift log", icon: ListPlus, roles: ALL, ready: true },
      { href: "/data", label: "Data table", icon: Table2, roles: ALL, ready: true },
    ],
  },
  {
    label: "Accountability",
    items: [
      { href: "/actions", label: "Issues & CAPAs", icon: Zap, roles: SUPERVISOR_UP, ready: true },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/report", label: "Shift report", icon: ClipboardList, roles: SUPERVISOR_UP, ready: true },
      { href: "/oee", label: "OEE & Downtime", icon: BarChart3, roles: SUPERVISOR_UP, ready: false },
      { href: "/quality", label: "Quality", icon: Sparkles, roles: SUPERVISOR_UP, ready: false },
      { href: "/trends", label: "Trends", icon: TrendingUp, roles: MANAGER_UP, ready: false },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/admin", label: "Admin & Settings", icon: Settings, roles: MANAGER_UP, ready: true },
    ],
  },
];

/** Nav sections filtered to what this role may see (empty sections dropped). */
export function navForRole(role: FactoryRole): NavSection[] {
  return FACTORY_NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}
