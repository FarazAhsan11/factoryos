"use client";

import {
  BoardPageSkeleton,
  ListPageSkeleton,
  PageSkeleton,
  SearchPageSkeleton,
  SettingsPageSkeleton,
  SplitPageSkeleton,
  TablePageSkeleton,
} from "@/components/factory/page-skeleton";
import { useSidebar } from "@/components/factory/sidebar-context";
import { cn } from "@/lib/utils";

/**
 * The page area's half of rail navigation.
 *
 * A rail click used to leave the page you were leaving on screen until the
 * server had answered for the next one — the route's own `loading.tsx` can
 * only be shown once the server has sent it, and in development that includes
 * compiling the route. So the page area answers the click itself: the moment
 * a destination is pending it shows that page's skeleton, the same shape its
 * `loading.tsx` draws, and the real page replaces it as soon as it arrives.
 *
 * The page being left is hidden rather than unmounted, so nothing is torn
 * down twice if the route commits in the next frame; it goes when the new
 * page takes its place.
 *
 * `display: contents` keeps both wrappers out of the layout: the page's root
 * stays a direct flex child of `<main>`, which is what its `lg:flex-1` sizing
 * depends on.
 */
export function NavigationFrame({ children }: { children: React.ReactNode }) {
  const { pendingHref } = useSidebar();

  return (
    <>
      <div className={cn("contents", pendingHref && "hidden")}>{children}</div>
      {pendingHref && <PendingSkeleton href={pendingHref} />}
    </>
  );
}

/** The skeleton of the page an href leads to — the one its loading.tsx draws. */
function PendingSkeleton({ href }: { href: string }) {
  // "/factory/<slug>/log?tab=report" → "/log"
  const section = href
    .split("?")[0]
    .replace(/^\/factory\/[^/]+/, "")
    .replace(/\/$/, "");

  switch (section) {
    case "/log":
      return <SplitPageSkeleton variant="log" />;
    case "/kaizen":
      return <SplitPageSkeleton variant="kaizen" />;
    case "/pipeline":
      return <BoardPageSkeleton />;
    case "/actions":
      return <ListPageSkeleton />;
    case "/maintenance":
      return <ListPageSkeleton action />;
    case "/deviations":
      return <TablePageSkeleton className="max-w-[1600px]" />;
    case "/data":
      return <TablePageSkeleton className="max-w-[1600px]" />;
    case "/products":
      return <TablePageSkeleton className="max-w-6xl" heading={false} />;
    case "/admin":
      return <SettingsPageSkeleton tabs={5} />;
    case "/resources":
      return <SettingsPageSkeleton tabs={2} />;
    case "/batch":
      return <SearchPageSkeleton />;
    default:
      return <PageSkeleton />;
  }
}
