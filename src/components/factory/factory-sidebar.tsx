"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, PanelLeftClose, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FactoryRole } from "@/lib/factory/context";
import {
  activeHrefs,
  navForRole,
  type ResolvedGroup,
  type ResolvedLink,
  type UnitWords,
} from "@/lib/factory/nav";
import { prefetchModule } from "@/lib/factory/nav-prefetch";
import { useSidebar } from "@/components/factory/sidebar-context";

/** What every rail link needs to navigate and warm its page — built once. */
interface LinkProps {
  base: string;
  onWarm: (href: string) => void;
  onGo: (event: React.MouseEvent, href: string) => void;
}

/**
 * Left rail for the factory workspace. Sections and items are role-gated;
 * modules that don't exist yet render disabled with a "Soon" tag.
 *
 * A screen that used to be a tab strip inside its page — the pipeline's three
 * views, the shift log's two, Resources and Admin — is a **group** here: a
 * named heading that folds open to its screens. The page gave the strip's row
 * back to its content, and reads which screen it is on from `?tab=`. The
 * group holding the open page starts unfolded; the rest start folded, and
 * each remembers being opened or closed for as long as the rail is mounted.
 *
 * Choosing another screen of the page already open only rewrites the URL
 * (`history.pushState`) — no server round trip, and a half-typed form on the
 * page survives the look at its neighbour, exactly as it did behind the tab.
 *
 * Two shapes, one component. From `lg` up it is a static rail that collapses
 * to a 72px icon strip, and the preference sticks per browser. Below `lg` it
 * is an off-canvas drawer over the page, opened from the header menu button.
 *
 * Navigation is optimistic: the clicked item highlights in the same frame as
 * the click, and the page area swaps to that page's skeleton at once (see
 * `NavigationFrame`). There is no spinner on the item — the page area already
 * says the page is on its way, and a second indicator in the rail only made
 * the switch look slower than it was.
 *
 * Pointing at an item also starts on the page's lists (`prefetchModule`), so
 * they load alongside the route instead of after it.
 */
export function FactorySidebar({
  factoryId,
  slug,
  role,
  units,
  factoryName,
  logoUrl,
}: {
  /** Which tenant's lists to warm when an item is pointed at. */
  factoryId: string;
  slug: string;
  role: FactoryRole;
  /** The plant's word for its rooms — "Room schedule", "Line schedule". */
  units: UnitWords;
  factoryName: string;
  logoUrl: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  /** Groups the user folded or unfolded; the rest follow the open page. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const {
    collapsed,
    toggleCollapsed,
    mobileOpen,
    setMobileOpen,
    mounted,
    pendingHref,
    navigate,
  } = useSidebar();
  const base = `/factory/${slug}`;

  // While a navigation is in flight, treat the destination as current. Once
  // the transition settles we fall back to the real pathname — no effect and
  // no stale state to clear.
  const [livePath, liveQuery] = pendingHref
    ? pendingHref.split("?")
    : [pathname, searchParams.toString()];
  const liveTab = new URLSearchParams(liveQuery ?? "").get("tab");
  // "/factory/acme/pipeline/…" → "/pipeline"; the overview is "".
  const rest = livePath.startsWith(base) ? livePath.slice(base.length) : "";
  const section = rest ? `/${rest.split("/")[1]}` : "";

  const sections = navForRole(role, units);
  const active = activeHrefs(sections, section, liveTab);

  const linkProps: LinkProps = {
    base,
    onWarm: (href) => prefetchModule(queryClient, factoryId, href),
    onGo: (event, href) => {
      // Let modified clicks (new tab, etc.) behave normally.
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      setMobileOpen(false);
      const target = `${base}${href}`;
      const [targetPath, targetQuery = ""] = target.split("?");
      if (targetPath === pathname && !pendingHref) {
        // Another screen of the page already open. The page reads its tab
        // from the URL, so rewriting the URL *is* the switch — nothing for
        // the server to do, and nothing on the page is torn down.
        if (targetQuery !== searchParams.toString()) {
          window.history.pushState(null, "", target);
        }
        return;
      }
      navigate(target);
    },
  };

  // The collapse is a desktop idea only: an icon strip you had to open a
  // drawer to reach would be a worse rail, not a smaller one. Every collapsed
  // style below is therefore `lg:`-prefixed.
  const icons = collapsed;

  return (
    <>
      {/* Scrim. Fades rather than pops, and tapping the page is the gesture
          people reach for before they look for the X. */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden print:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-line bg-gradient-to-b from-surface to-sunken shadow-2xl shadow-ink/10",
          "transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // From lg up it stops floating: it is part of the flex row, drops the
          // shadow, and width becomes the animated property instead of offset.
          // It keeps a z-index above the top bar's, though — the collapsed
          // rail's hover labels overhang into the bar's column, and at
          // `z-auto` the bar painted its own background straight over them.
          "lg:static lg:z-40 lg:shrink-0 lg:translate-x-0 lg:shadow-none",
          mounted && "lg:transition-[width]",
          icons ? "lg:w-[4.5rem]" : "lg:w-64",
          "print:hidden",
        )}
      >
        {/* The rail owns the tenant's identity — the top bar carries it only
            below `lg`, where there is no rail to carry it. Collapsed, the mark
            *is* the control: clicking it opens the rail back up, which is the
            one thing you can want from a 72px strip. */}
        <div
          className={cn(
            "flex h-[3.75rem] shrink-0 items-center gap-2.5 border-b border-line px-3",
            icons && "lg:justify-center lg:px-0",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2.5",
              icons && "lg:hidden",
            )}
          >
            <FactoryMark logoUrl={logoUrl} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {factoryName}
              </p>
              <p className="truncate text-[11px] text-ink-5">
                {slug || "factory"} · workspace
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-4 transition hover:bg-brand-soft hover:text-brand lg:hidden"
          >
            <X className="size-4" />
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={icons ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!icons}
            title={icons ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "group relative hidden shrink-0 place-items-center rounded-lg transition lg:grid",
              icons
                ? "size-9"
                : "size-9 text-ink-5 hover:bg-brand-soft hover:text-brand",
            )}
          >
            {icons ? (
              <>
                <FactoryMark logoUrl={logoUrl} />
                <Tip>Expand sidebar</Tip>
              </>
            ) : (
              <PanelLeftClose className="size-[18px]" />
            )}
          </button>
        </div>

        <nav
          className={cn(
            "scrollbar-slim flex-1 overflow-y-auto overflow-x-hidden px-3 py-4",
            icons && "lg:px-2.5",
          )}
        >
          {sections.map((section, index) => (
            <div key={section.label ?? index} className="mb-5 last:mb-0">
              {/* Collapsed, a section title has nowhere to go — a hairline
                  keeps the grouping without pretending to be a word. */}
              {section.label && (
                <p
                  className={cn(
                    "px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-5",
                    icons && "lg:hidden",
                  )}
                >
                  {section.label}
                </p>
              )}
              {icons && section.label && (
                <div className="mx-auto mb-2.5 hidden h-px w-7 rounded-full bg-line lg:block" />
              )}

              <ul className="space-y-1">
                {section.items.map((entry) =>
                  "children" in entry ? (
                    <NavGroupItem
                      key={entry.label}
                      group={entry}
                      icons={icons}
                      active={active}
                      open={
                        openGroups[entry.label] ??
                        entry.children.some((c) => active.has(c.href))
                      }
                      onToggle={(open) =>
                        setOpenGroups((prev) => ({
                          ...prev,
                          [entry.label]: open,
                        }))
                      }
                      linkProps={linkProps}
                    />
                  ) : (
                    <li key={entry.label}>
                      <TopLink
                        link={entry}
                        icons={icons}
                        active={active.has(entry.href)}
                        linkProps={linkProps}
                      />
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

const ROW =
  "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200";
/** The collapsed desktop strip: every row becomes a centred 44px square. */
const ROW_ICONS =
  "lg:mx-auto lg:size-11 lg:justify-center lg:gap-0 lg:px-0 lg:py-0";
const ROW_ACTIVE =
  // No transition into the active state: the gradient can't animate, so
  // easing only the text colour left the item half-selected for 200ms.
  "bg-gradient-to-r from-brand to-brand-bright font-semibold text-white shadow-brand transition-none";
const ROW_IDLE =
  "text-ink-3 hover:bg-surface hover:text-ink hover:shadow-soft";

/** A screen that stands alone — one click, no group. */
function TopLink({
  link,
  icons,
  active,
  linkProps,
}: {
  link: ResolvedLink;
  icons: boolean;
  active: boolean;
  linkProps: LinkProps;
}) {
  const Icon = link.icon!;

  if (!link.ready) {
    return (
      <span
        aria-disabled
        title="Arrives in a later build step"
        className={cn(ROW, icons && ROW_ICONS, "cursor-not-allowed text-ink-6")}
      >
        <Icon className="size-[18px] shrink-0" />
        <Label hidden={icons}>{link.label}</Label>
        <Soon hidden={icons} />
        {icons && <Tip>{link.label} · soon</Tip>}
      </span>
    );
  }

  return (
    <Link
      href={`${linkProps.base}${link.href}`}
      prefetch
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => linkProps.onWarm(link.href)}
      onFocus={() => linkProps.onWarm(link.href)}
      onTouchStart={() => linkProps.onWarm(link.href)}
      onClick={(event) => linkProps.onGo(event, link.href)}
      className={cn(ROW, icons && ROW_ICONS, active ? ROW_ACTIVE : ROW_IDLE)}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-transform duration-200",
          !active && "group-hover:scale-110",
        )}
      />
      <Label hidden={icons}>{link.label}</Label>
      {icons && <Tip>{link.label}</Tip>}
    </Link>
  );
}

/**
 * A heading that folds open to its screens.
 *
 * Unfolded, the screens hang off a guide line under the heading's icon, and
 * the open one is marked on that line — so the eye finds "where am I" by
 * running down one rule rather than reading every label. The heading itself
 * turns brand-coloured while one of its screens is open, and stays that way
 * when folded, so a closed group still says it holds the current page.
 *
 * In the collapsed desktop strip there is no room to unfold, so the icon
 * opens a flyout beside the rail instead, listing the same screens.
 */
function NavGroupItem({
  group,
  icons,
  active,
  open,
  onToggle,
  linkProps,
}: {
  group: ResolvedGroup;
  icons: boolean;
  active: Set<string>;
  open: boolean;
  onToggle: (open: boolean) => void;
  linkProps: LinkProps;
}) {
  const Icon = group.icon;
  const holdsActive = group.children.some((c) => active.has(c.href));
  const anyReady = group.children.some((c) => c.ready);
  const listId = `nav-group-${group.label.replace(/\W+/g, "-").toLowerCase()}`;
  /** Where the collapsed strip's flyout sits — measured when it opens. */
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(
    null,
  );

  function showFlyout(target: HTMLElement) {
    if (!icons) return;
    const row = target.getBoundingClientRect();
    // Measured against the rail, not the viewport: the rail is transformed
    // (it slides in as a drawer below `lg`), which makes it the containing
    // block of anything `fixed` inside it.
    const rail = target.closest("aside")?.getBoundingClientRect();
    setFlyout({
      top: row.top - (rail?.top ?? 0),
      left: row.right - (rail?.left ?? 0),
    });
  }

  return (
    <li
      onMouseEnter={(event) => showFlyout(event.currentTarget)}
      onMouseLeave={() => setFlyout(null)}
      onFocus={(event) => {
        if (!flyout) showFlyout(event.currentTarget);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFlyout(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setFlyout(null);
      }}
    >
      <button
        type="button"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          ROW,
          icons && ROW_ICONS,
          holdsActive
            ? cn(
                "font-semibold text-ink hover:bg-surface hover:shadow-soft",
                // Folded into the strip, the group *is* the current page's
                // only marker — so it takes the full active treatment there.
                icons &&
                  "lg:bg-gradient-to-r lg:from-brand lg:to-brand-bright lg:text-white lg:shadow-brand",
              )
            : anyReady
              ? ROW_IDLE
              : "text-ink-5 hover:bg-surface hover:text-ink-3",
        )}
      >
        <Icon
          className={cn(
            "size-[18px] shrink-0 transition-transform duration-200",
            holdsActive
              ? cn("text-brand", icons && "lg:text-white")
              : "group-hover:scale-110",
          )}
        />
        <Label hidden={icons}>{group.label}</Label>
        {!anyReady && <Soon hidden={icons} />}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-ink-5 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            !open && "-rotate-90",
            icons && "lg:hidden",
          )}
        />
      </button>

      {/* Folds by animating the row track from 0fr to 1fr — the one way to
          ease a height of "whatever the content is" without measuring it.
          `inert` while folded, so Tab never lands on a link nobody can see. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          icons && "lg:hidden",
        )}
        inert={!open}
      >
        <div id={listId} className="min-h-0 overflow-hidden">
          <ul
            aria-label={group.label}
            className="ml-[1.3rem] mt-1 space-y-0.5 border-l border-line pb-1 pl-2.5"
          >
            {group.children.map((child) => (
              <li key={child.href}>
                <SubLink
                  link={child}
                  active={active.has(child.href)}
                  onRule
                  linkProps={linkProps}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The collapsed strip's flyout. `pl-2` is a bridge of transparent
          padding between rail and card, so the pointer can cross the gap
          without leaving the group and closing it. */}
      {icons && flyout && (
        <div
          className="fixed z-50 hidden pl-2 lg:block"
          style={{ top: flyout.top, left: flyout.left }}
        >
          <div className="w-60 animate-in fade-in-0 slide-in-from-left-1 rounded-xl border border-line bg-surface p-1.5 shadow-xl shadow-ink/10 duration-150">
            <p className="flex items-center gap-2 px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-5">
              <Icon className="size-3.5" aria-hidden />
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.children.map((child) => (
                <li key={child.href}>
                  <SubLink
                    link={child}
                    active={active.has(child.href)}
                    linkProps={{
                      ...linkProps,
                      onGo: (event, href) => {
                        setFlyout(null);
                        linkProps.onGo(event, href);
                      },
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

/** One screen inside a group. Quieter than a top link — it is a sub-item. */
function SubLink({
  link,
  active,
  onRule = false,
  linkProps,
}: {
  link: ResolvedLink;
  active: boolean;
  /** Hanging off the group's guide line, so the open one ticks the line. */
  onRule?: boolean;
  linkProps: LinkProps;
}) {
  const row =
    "relative flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors duration-150";

  if (!link.ready) {
    return (
      <span
        aria-disabled
        title="Arrives in a later build step"
        className={cn(row, "cursor-not-allowed text-ink-6")}
      >
        <span className="flex-1 truncate">{link.label}</span>
        <Soon hidden={false} />
      </span>
    );
  }

  return (
    <Link
      href={`${linkProps.base}${link.href}`}
      prefetch
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => linkProps.onWarm(link.href)}
      onFocus={() => linkProps.onWarm(link.href)}
      onTouchStart={() => linkProps.onWarm(link.href)}
      onClick={(event) => linkProps.onGo(event, link.href)}
      className={cn(
        row,
        active
          ? "bg-brand-soft font-semibold text-brand-deep"
          : "text-ink-4 hover:bg-surface hover:text-ink hover:shadow-soft",
        // The marker sits on the group's guide line (past the list's
        // padding), so the open screen is ticked on the rule itself. The
        // flyout has no rule to tick, and the tint alone carries it there.
        active &&
          onRule &&
          "before:absolute before:-left-[11.5px] before:top-1/2 before:h-5 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-brand",
      )}
    >
      <span className="flex-1 truncate">{link.label}</span>
    </Link>
  );
}

function Soon({ hidden }: { hidden: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full bg-sunken-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-5",
        hidden && "lg:hidden",
      )}
    >
      Soon
    </span>
  );
}

/** The tenant's logo, or a neutral mark when the factory hasn't set one. */
function FactoryMark({ logoUrl }: { logoUrl: string | null }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className="size-9 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-soft to-brand-line text-brand"
    >
      <Building2 className="size-[18px]" />
    </span>
  );
}

/** Item text: present in the drawer, folded away in the desktop icon strip. */
function Label({
  hidden,
  children,
}: {
  hidden: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("flex-1 truncate text-left", hidden && "lg:hidden")}>
      {children}
    </span>
  );
}

/** Hover label for the collapsed rail — the only place the name can live. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 -translate-x-1.5 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 lg:block"
    >
      {children}
    </span>
  );
}
