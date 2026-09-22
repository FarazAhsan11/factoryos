import {
  Activity,
  BarChart3,
  Boxes,
  FileSearch,
  FileWarning,
  Lightbulb,
  LayoutGrid,
  ListPlus,
  Package,
  Settings,
  Sparkles,
  Table2,
  TrendingUp,
  Wrench,
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
      {
        href: "",
        label: "Dashboard",
        icon: LayoutGrid,
        roles: SUPERVISOR_UP,
        ready: true,
      },
      {
        href: "/pipeline",
        label: "Pipeline",
        icon: Activity,
        roles: ALL,
        ready: true,
      },
      // The batch catalogue, directly under the board it feeds: a batch is
      // raised here, with its customer order, and planned there. It was
      // Resources' third tab until it became a screen people work in.
      {
        href: "/products",
        label: "Products",
        icon: Package,
        roles: MANAGER_UP,
        ready: true,
      },
      {
        href: "/log",
        label: "Shift log",
        icon: ListPlus,
        roles: ALL,
        ready: true,
      },
      {
        href: "/data",
        label: "Data table",
        icon: Table2,
        roles: ALL,
        ready: true,
      },
      // The two registers the floor reads names from — machines and people.
      // They used to sit at the end of the Admin strip, which buried
      // day-to-day records under one-time configuration.
      {
        href: "/resources",
        label: "Resources",
        icon: Boxes,
        roles: MANAGER_UP,
        ready: true,
      },
      // One batch, everything that happened to it — the shift log, the issues
      // and the maintenance requests that name it, gathered and read-only.
      // Everyone, because the question it answers ("what happened to 47004?")
      // is asked by whoever is holding the batch, not by whoever manages it.
      {
        href: "/batch",
        label: "Batch record",
        icon: FileSearch,
        roles: ALL,
        ready: true,
      },
    ],
  },
  {
    label: "Accountability",
    items: [
      {
        href: "/actions",
        label: "Issues & CAPAs",
        icon: Zap,
        roles: SUPERVISOR_UP,
        ready: true,
      },
      {
        href: "/maintenance",
        label: "Maintenance",
        icon: Wrench,
        roles: ALL,
        ready: true,
      },
      // The QA register. Supervisor and up, as in the prototype: raising a
      // quarantine NCR stops a batch, and closing one is a QA sign-off.
      {
        href: "/deviations",
        label: "Deviations & NCRs",
        icon: FileWarning,
        roles: SUPERVISOR_UP,
        ready: true,
      },
    ],
  },
  {
    label: "Analytics",
    items: [
      // Where Shift report used to be. The report moved into the shift log's
      // second tab — reading the sheet and correcting an entry are the same
      // job, minutes apart — and Kaizen came out of that tab to here, because
      // an improvement idea is not something anyone has while filing a
      // downtime record. Everyone may raise one; review is supervisor and up.
      {
        href: "/kaizen",
        label: "Kaizen",
        icon: Lightbulb,
        roles: ALL,
        ready: true,
      },
      {
        href: "/oee",
        label: "OEE & Downtime",
        icon: BarChart3,
        roles: SUPERVISOR_UP,
        ready: false,
      },
      {
        href: "/quality",
        label: "Quality",
        icon: Sparkles,
        roles: SUPERVISOR_UP,
        ready: false,
      },
      {
        href: "/trends",
        label: "Trends",
        icon: TrendingUp,
        roles: MANAGER_UP,
        ready: false,
      },
    ],
  },
  {
    label: "Setup",
    items: [
      {
        href: "/admin",
        label: "Admin & Settings",
        icon: Settings,
        roles: MANAGER_UP,
        ready: true,
      },
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
