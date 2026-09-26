import {
  Boxes,
  CalendarRange,
  ClipboardList,
  FileSearch,
  FileWarning,
  Gauge,
  LayoutDashboard,
  Lightbulb,
  Settings2,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import type { FactoryRole } from "@/lib/factory/context";

type Icon = typeof LayoutDashboard;

/** The factory's own words for its rooms — "Rooms", "Lines", "Cells". */
export interface UnitWords {
  singular: string;
  plural: string;
}

export interface NavLink {
  /**
   * Path appended to /factory/<slug> — "" is the overview itself. A screen
   * that lives on a tab of a page carries it as `?tab=`: the rail is where the
   * page's sections are chosen now, and the page reads the tab from the URL.
   */
  href: string;
  /** A function where the plant names the thing itself (its unit word). */
  label: string | ((units: UnitWords) => string);
  /** Top-level links carry one; a group's children inherit the group's. */
  icon?: Icon;
  roles: FactoryRole[];
  /** False until the screen is actually built; rendered as "Soon". */
  ready: boolean;
}

export interface NavGroup {
  label: string;
  icon: Icon;
  children: NavLink[];
}

export type NavEntry = NavLink | NavGroup;

export interface NavSection {
  /** Null for the unheaded block at the top of the rail. */
  label: string | null;
  items: NavEntry[];
}

export function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
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

/**
 * The rail, arranged the way a plant's day runs: plan the work, run it on the
 * floor, deal with what went wrong, get better, and — once, at the bottom —
 * the setup everything else reads from.
 *
 * Every name says what the screen is *for* on a factory floor rather than
 * what widget it is: "Room schedule", not "Schedule tab"; "Shift handover",
 * not "Shift report". A group exists only where its screens are one job seen
 * from several sides (the plan read by batch, by room, by family); a screen
 * that stands alone stays a single link, one click away.
 */
export const FACTORY_NAV: NavSection[] = [
  {
    label: null,
    items: [
      {
        href: "",
        label: "Plant overview",
        icon: LayoutDashboard,
        roles: SUPERVISOR_UP,
        ready: true,
      },
    ],
  },
  {
    label: "Operations",
    items: [
      // From order to plan. The order book comes first because a batch is
      // raised there, with its customer order, before it can be planned.
      {
        label: "Production planning",
        icon: CalendarRange,
        children: [
          {
            href: "/products",
            label: "Order book",
            roles: MANAGER_UP,
            ready: true,
          },
          {
            href: "/pipeline?tab=board",
            label: "Batch board",
            roles: ALL,
            ready: true,
          },
          {
            href: "/pipeline?tab=schedule",
            label: (u) => `${u.singular} schedule`,
            roles: ALL,
            ready: true,
          },
          {
            href: "/pipeline?tab=families",
            label: "Batch families",
            roles: ALL,
            ready: true,
          },
          {
            href: "/pipeline?tab=gantt",
            label: "Gantt timeline",
            roles: ALL,
            ready: false,
          },
          {
            href: "/pipeline?tab=archive",
            label: "Completed batches",
            roles: ALL,
            ready: false,
          },
        ],
      },
      // What the floor records, shift by shift: filing it, handing it over,
      // and looking back through all of it.
      {
        label: "Shop floor",
        icon: ClipboardList,
        children: [
          {
            href: "/log?tab=entry",
            label: "Production log",
            roles: ALL,
            ready: true,
          },
          {
            href: "/log?tab=report",
            label: "Shift handover",
            roles: SUPERVISOR_UP,
            ready: true,
          },
          {
            href: "/data",
            label: "Log history",
            roles: ALL,
            ready: true,
          },
        ],
      },
      // One batch, everything that happened to it. Everyone, because "what
      // happened to 47004?" is asked by whoever is holding the batch.
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
    label: "Quality & maintenance",
    items: [
      {
        href: "/actions",
        label: "Issues & CAPA",
        icon: ShieldAlert,
        roles: SUPERVISOR_UP,
        ready: true,
      },
      // Supervisor and up: raising a quarantine NCR stops a batch, and
      // closing one is a QA sign-off.
      {
        href: "/deviations",
        label: "Deviations & NCRs",
        icon: FileWarning,
        roles: SUPERVISOR_UP,
        ready: true,
      },
      // The module is the breakdown request, not planned maintenance —
      // named for what it is so nobody looks here for a PM calendar.
      {
        href: "/maintenance",
        label: "Breakdown maintenance",
        icon: Wrench,
        roles: ALL,
        ready: true,
      },
    ],
  },
  {
    label: "Improvement",
    items: [
      {
        href: "/kaizen",
        label: "Kaizen ideas",
        icon: Lightbulb,
        roles: ALL,
        ready: true,
      },
      {
        label: "Performance",
        icon: Gauge,
        children: [
          {
            href: "/oee",
            label: "OEE & downtime",
            roles: SUPERVISOR_UP,
            ready: false,
          },
          {
            href: "/quality",
            label: "Quality metrics",
            roles: SUPERVISOR_UP,
            ready: false,
          },
          {
            href: "/trends",
            label: "Trends",
            roles: MANAGER_UP,
            ready: false,
          },
        ],
      },
    ],
  },
  {
    label: "Plant setup",
    items: [
      // The two registers the floor names things from. Day-to-day records,
      // so they sit apart from the configuration set once below.
      {
        label: "Resources",
        icon: Boxes,
        children: [
          {
            href: "/resources?tab=equipment",
            label: "Equipment register",
            roles: MANAGER_UP,
            ready: true,
          },
          {
            href: "/resources?tab=employees",
            label: "Workforce",
            roles: MANAGER_UP,
            ready: true,
          },
        ],
      },
      {
        label: "Configuration",
        icon: Settings2,
        children: [
          {
            href: "/admin?tab=company",
            label: "Company profile",
            roles: MANAGER_UP,
            ready: true,
          },
          {
            href: "/admin?tab=units",
            label: (u) => u.plural,
            roles: MANAGER_UP,
            ready: true,
          },
          {
            href: "/admin?tab=processes",
            label: "Process stages",
            roles: MANAGER_UP,
            ready: true,
          },
          {
            href: "/admin?tab=departments",
            label: "Departments",
            roles: MANAGER_UP,
            ready: true,
          },
          {
            href: "/admin?tab=shift-times",
            label: "Shift pattern",
            roles: MANAGER_UP,
            ready: true,
          },
        ],
      },
    ],
  },
];

export interface ResolvedLink extends Omit<NavLink, "label"> {
  label: string;
}
export interface ResolvedGroup extends Omit<NavGroup, "children"> {
  children: ResolvedLink[];
}
export type ResolvedEntry = ResolvedLink | ResolvedGroup;
export interface ResolvedSection {
  label: string | null;
  items: ResolvedEntry[];
}

function resolveLink(link: NavLink, units: UnitWords): ResolvedLink {
  return {
    ...link,
    label: typeof link.label === "function" ? link.label(units) : link.label,
  };
}

/**
 * The rail for this role, in the plant's own words. Children the role may not
 * see are dropped, then any group left empty, then any section left empty —
 * an operator never sees a "Configuration" heading with nothing under it.
 */
export function navForRole(
  role: FactoryRole,
  units: UnitWords,
): ResolvedSection[] {
  return FACTORY_NAV.map((section) => ({
    label: section.label,
    items: section.items.flatMap<ResolvedEntry>((entry) => {
      if (isGroup(entry)) {
        const children = entry.children
          .filter((child) => child.roles.includes(role))
          .map((child) => resolveLink(child, units));
        return children.length > 0 ? [{ ...entry, children }] : [];
      }
      return entry.roles.includes(role) ? [resolveLink(entry, units)] : [];
    }),
  })).filter((section) => section.items.length > 0);
}

/** Splits "/pipeline?tab=schedule" into its path and its tab. */
export function splitHref(href: string): { path: string; tab: string | null } {
  const [path, query = ""] = href.split("?");
  return { path, tab: new URLSearchParams(query).get("tab") };
}

/**
 * Which rail links are the page being looked at. A link without a tab matches
 * its path; a link with one matches when the URL names that tab — or, when
 * the URL names none (or one this role has no link for), when it is the first
 * link for its path, since that is the tab the page falls back to.
 */
export function activeHrefs(
  sections: ResolvedSection[],
  path: string,
  tab: string | null,
): Set<string> {
  const links = sections.flatMap((s) =>
    s.items.flatMap((e) => ("children" in e ? e.children : [e])),
  );
  const forPath = links.filter(
    (link) => link.ready && splitHref(link.href).path === path,
  );
  const exact = forPath.find((link) => splitHref(link.href).tab === tab);
  const match = exact ?? forPath[0];
  return new Set(match ? [match.href] : []);
}
