"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Loader2, PanelLeftClose, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FactoryRole } from "@/lib/factory/context";
import { navForRole } from "@/lib/factory/nav";
import { useSidebar } from "@/components/factory/sidebar-context";

/**
 * Left rail for the factory workspace. Sections and items are role-gated;
 * modules that don't exist yet render disabled with a "Soon" tag.
 *
 * Two shapes, one component. From `lg` up it is a static rail that collapses
 * to a 72px icon strip, and the preference sticks per browser. Below `lg` it
 * is an off-canvas drawer over the page, opened from the header menu button.
 *
 * Navigation is optimistic: the clicked item highlights immediately and shows
 * a spinner while the route streams in, so the rail never looks frozen.
 */
export function FactorySidebar({
  slug,
  role,
  factoryName,
  logoUrl,
}: {
  slug: string;
  role: FactoryRole;
  factoryName: string;
  logoUrl: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen, mounted } =
    useSidebar();
  const base = `/factory/${slug}`;

  // While a navigation is in flight, treat the destination as current. Once
  // the transition settles we fall back to the real pathname — no effect and
  // no stale state to clear.
  const currentPath = isPending && pendingHref ? pendingHref : pathname;

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
          {navForRole(role).map((section) => (
            <div key={section.label} className="mb-5 last:mb-0">
              {/* Collapsed, a section title has nowhere to go — a hairline
                  keeps the grouping without pretending to be a word. */}
              <p
                className={cn(
                  "px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-5",
                  icons && "lg:hidden",
                )}
              >
                {section.label}
              </p>
              {icons && (
                <div className="mx-auto mb-2.5 hidden h-px w-7 rounded-full bg-line lg:block" />
              )}

              <ul className="space-y-1">
                {section.items.map((item) => {
                  const href = `${base}${item.href}`;
                  const active =
                    item.href === ""
                      ? currentPath === base
                      : currentPath.startsWith(href);
                  const loading = isPending && pendingHref === href;

                  const shared = cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200",
                    icons &&
                      "lg:mx-auto lg:size-11 lg:justify-center lg:gap-0 lg:px-0 lg:py-0",
                  );

                  if (!item.ready) {
                    return (
                      <li key={item.label}>
                        <span
                          aria-disabled
                          title="Arrives in a later build step"
                          className={cn(
                            shared,
                            "cursor-not-allowed text-ink-6",
                          )}
                        >
                          <item.icon className="size-[18px] shrink-0" />
                          <Label hidden={icons}>{item.label}</Label>
                          <span
                            className={cn(
                              "rounded-full bg-sunken-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-5",
                              icons && "lg:hidden",
                            )}
                          >
                            Soon
                          </span>
                          {icons && <Tip>{item.label} · soon</Tip>}
                        </span>
                      </li>
                    );
                  }

                  return (
                    <li key={item.label}>
                      <Link
                        href={href}
                        prefetch
                        aria-current={active ? "page" : undefined}
                        onClick={(event) => {
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
                          if (href === pathname) return;
                          setPendingHref(href);
                          startTransition(() => router.push(href));
                        }}
                        className={cn(
                          shared,
                          active
                            ? "bg-gradient-to-r from-brand to-brand-bright font-semibold text-white shadow-brand"
                            : "text-ink-3 hover:bg-surface hover:text-ink hover:shadow-soft",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "size-[18px] shrink-0 transition-transform duration-200",
                            !active && "group-hover:scale-110",
                          )}
                        />
                        <Label hidden={icons}>{item.label}</Label>
                        {loading && (
                          <Loader2
                            className={cn(
                              "size-3.5 shrink-0 animate-spin",
                              active ? "text-white" : "text-brand",
                              icons && "lg:absolute lg:right-1 lg:top-1",
                            )}
                          />
                        )}
                        {icons && <Tip>{item.label}</Tip>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
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
