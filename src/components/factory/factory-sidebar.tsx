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
          "rail-surface fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-white/[0.06] text-rail-ink-2 shadow-2xl shadow-ink/30",
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
            "flex h-[3.75rem] shrink-0 items-center gap-2.5 border-b border-white/[0.07] px-3",
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
              <p className="truncate text-[0.8125rem] font-semibold tracking-[0.005em] text-rail-ink">
                {factoryName}
              </p>
              <p className="truncate text-[0.65625rem] text-rail-ink-3">
                {slug || "factory"} · workspace
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-rail-ink-3 transition hover:bg-white/[0.08] hover:text-rail-ink lg:hidden"
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
                : "size-9 text-rail-ink-3 hover:bg-white/[0.08] hover:text-rail-ink",
            )}
          >
            {icons ? (
              <>
                <FactoryMark logoUrl={logoUrl} />
                <Tip>Expand sidebar</Tip>
              </>
            ) : (
              <PanelLeftClose className="size-[1.125rem]" />
            )}
          </button>
        </div>

        <nav
          className={cn(
            "scrollbar-slim scrollbar-rail flex-1 overflow-y-auto overflow-x-hidden px-3 py-4",
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
                    "px-3 pb-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-rail-ink-3",
                    icons && "lg:hidden",
                  )}
                >
                  {section.label}
                </p>
              )}
              {icons && section.label && (
                <div className="mx-auto mb-2.5 hidden h-px w-7 rounded-full bg-white/10 lg:block" />
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
  "group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[0.8125rem] leading-5 tracking-[0.005em] transition-all duration-200";
/** The collapsed desktop strip: every row becomes a centred 44px square. */
const ROW_ICONS =
  "lg:mx-auto lg:size-11 lg:justify-center lg:gap-0 lg:px-0 lg:py-0";
const ROW_ACTIVE =
  // No transition into the active state: the gradient can't animate, so
  // easing only the text colour left the item half-selected for 200ms.
  "bg-gradient-to-r from-brand-bright/35 to-brand-bright/10 font-medium text-white ring-1 ring-inset ring-white/[0.07] shadow-[0_8px_24px_-12px_var(--color-brand)] transition-none";
const ROW_IDLE =
  "text-rail-ink-2 hover:bg-white/[0.06] hover:text-rail-ink";

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
        className={cn(ROW, icons && ROW_ICONS, "cursor-not-allowed text-rail-ink-4")}
      >
        <Icon className="size-4 shrink-0" />
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
          "size-4 shrink-0 transition-transform duration-200",
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
 * the open one is lifted by a tint of its own. The heading itself
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
                "font-medium text-rail-ink hover:bg-white/[0.06]",
                // Folded into the strip, the group *is* the current page's
                // only marker — so it takes the full active treatment there.
                icons &&
                  "lg:bg-gradient-to-r lg:from-brand-bright/35 lg:to-brand-bright/10 lg:text-white lg:ring-1 lg:ring-inset lg:ring-white/[0.07]",
              )
            : anyReady
              ? ROW_IDLE
              : "text-rail-ink-4 hover:bg-white/[0.04] hover:text-rail-ink-3",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0 transition-transform duration-200",
            holdsActive
              ? cn("text-brand-line", icons && "lg:text-white")
              : "group-hover:scale-110",
          )}
        />
        <Label hidden={icons}>{group.label}</Label>
        {!anyReady && <Soon hidden={icons} />}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-rail-ink-3 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
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
            className="ml-[1.3rem] mt-1 space-y-0.5 border-l border-white/10 pb-1 pl-2.5"
          >
            {group.children.map((child) => (
              <li key={child.href}>
                <SubLink
                  link={child}
                  active={active.has(child.href)}
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
          <div className="w-60 animate-in fade-in-0 slide-in-from-left-1 rounded-xl border border-white/[0.08] bg-rail p-1.5 shadow-xl shadow-ink/30 duration-150">
            <p className="flex items-center gap-2 px-2.5 pb-1.5 pt-1 text-[0.625rem] font-medium uppercase tracking-[0.12em] text-rail-ink-3">
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
  linkProps,
}: {
  link: ResolvedLink;
  active: boolean;
  linkProps: LinkProps;
}) {
  const row =
    "relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.78125rem] leading-5 transition-colors duration-150";

  if (!link.ready) {
    return (
      <span
        aria-disabled
        title="Arrives in a later build step"
        className={cn(row, "cursor-not-allowed text-rail-ink-4")}
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
          ? "bg-white/[0.08] font-medium text-white"
          : "text-rail-ink-2 hover:bg-white/[0.06] hover:text-rail-ink",
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
        "rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[0.5625rem] font-medium tracking-wide text-rail-ink-3 uppercase ring-1 ring-white/[0.08]",
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
        className="size-9 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-rail-ink-2 ring-1 ring-white/10"
    >
      <Building2 className="size-[1.125rem]" />
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
