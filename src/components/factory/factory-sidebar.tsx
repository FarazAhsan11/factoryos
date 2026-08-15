"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FactoryRole } from "@/lib/factory/context";
import { navForRole } from "@/lib/factory/nav";

/**
 * Left rail for the factory workspace. Sections and items are role-gated;
 * modules that don't exist yet render disabled with a "Soon" tag.
 *
 * Navigation is optimistic: the clicked item highlights immediately and shows
 * a spinner while the route streams in, so the rail never looks frozen.
 */
export function FactorySidebar({
  slug,
  role,
}: {
  slug: string;
  role: FactoryRole;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const base = `/factory/${slug}`;

  // While a navigation is in flight, treat the destination as current. Once
  // the transition settles we fall back to the real pathname — no effect and
  // no stale state to clear.
  const currentPath = isPending && pendingHref ? pendingHref : pathname;

  return (
    /* No sticky offset and no `100svh - 57px` guess any more: from `lg` up the
       rail sits inside a flex row that is already exactly the height left over
       below the header, and its wrapper does the scrolling. The old calc had
       to be kept in step with the header's padding by hand. */
    <nav className="min-h-full w-full border-b border-[#E6EAF1] bg-white px-3 py-4 lg:w-60 lg:border-r lg:border-b-0">
      {navForRole(role).map((section) => (
        <div key={section.label} className="mb-5 last:mb-0">
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const href = `${base}${item.href}`;
              const active =
                item.href === ""
                  ? currentPath === base
                  : currentPath.startsWith(href);
              const loading = isPending && pendingHref === href;

              if (!item.ready) {
                return (
                  <li key={item.label}>
                    <span
                      aria-disabled
                      title="Arrives in a later build step"
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#CBD5E1]"
                    >
                      <item.icon className="size-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-medium text-[#94A3B8]">
                        Soon
                      </span>
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
                      if (href === pathname) return;
                      setPendingHref(href);
                      startTransition(() => router.push(href));
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                      active
                        ? "bg-[#EFF4FF] font-semibold text-[#1D4ED8]"
                        : "text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F1B34]"
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {loading && (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-[#2563EB]" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
