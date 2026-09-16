import { cn } from "@/lib/utils";

/** Shared shimmer block for route-level loading states. */
export function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-xl bg-sunken-2", className)} />
  );
}

/**
 * Placeholder for a factory page body. Rendered by loading.tsx while the
 * segment streams in — the shell and sidebar stay put, only this area swaps.
 *
 * The generic shape, for the dashboard. Every workspace below has its own
 * skeleton cut to the page it stands in for: a loading state shaped like a
 * different page is a layout jump the moment the real one arrives, and that
 * jump is most of what makes a navigation feel slow.
 */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Frame className="max-w-5xl">
      <Heading />
      <Shimmer className="mt-1 h-12 w-full" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Shimmer key={i} className="h-20 w-full" />
        ))}
      </div>
    </Frame>
  );
}

/** Pipeline: heading with its buttons, the view strip, four board columns. */
export function BoardPageSkeleton() {
  return (
    <Frame className="max-w-[1500px]">
      <Heading actions={2} />
      <Tabs count={3} />
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:grid-rows-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-2xl border border-line bg-sunken lg:min-h-0"
          >
            <div className="h-[41px] shrink-0 animate-pulse border-b border-line bg-sunken-2" />
            <div className="space-y-2.5 p-2.5">
              <div className="h-28 animate-pulse rounded-xl bg-surface" />
              <div className="h-28 animate-pulse rounded-xl bg-surface" />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Issues & CAPAs, Maintenance: heading, a strip of filter chips, cards. */
export function ListPageSkeleton({ action = false }: { action?: boolean }) {
  return (
    <Frame className="max-w-5xl">
      <Heading actions={action ? 1 : 0} />
      <Tabs count={5} className="mb-4" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    </Frame>
  );
}

/** Data table, Products: a heading or toolbar over one wide table card. */
export function TablePageSkeleton({
  className,
  heading = true,
}: {
  className?: string;
  heading?: boolean;
}) {
  return (
    <Frame className={className}>
      {heading ? (
        <Heading actions={2} />
      ) : (
        <div className="mb-5 flex shrink-0 items-center justify-between gap-3">
          <Shimmer className="h-10 w-72" />
          <div className="flex gap-2">
            <Shimmer className="h-10 w-28" />
            <Shimmer className="h-10 w-28" />
          </div>
        </div>
      )}
      <Card>
        <div className="h-10 shrink-0 animate-pulse border-b border-line bg-sunken-2" />
        <div className="divide-y divide-line-soft">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Shimmer className="h-3.5 w-20 rounded-md" />
              <Shimmer className="h-3.5 w-40 rounded-md" />
              <Shimmer className="h-3.5 flex-1 rounded-md" />
              <Shimmer className="h-3.5 w-16 rounded-md" />
            </div>
          ))}
        </div>
      </Card>
    </Frame>
  );
}

/**
 * A work surface beside its feed — the shift log (tab strip first, no
 * heading) and Kaizen (a heading first, no tabs).
 */
export function SplitPageSkeleton({
  variant,
}: {
  variant: "log" | "kaizen";
}) {
  return (
    <Frame className="max-w-7xl">
      {variant === "log" ? (
        <div className="mb-5 flex shrink-0 items-center justify-between gap-3">
          <Tabs count={2} className="mb-0" />
          <Tabs count={2} className="mb-0" />
        </div>
      ) : (
        <div className="mb-3 shrink-0">
          <Shimmer className="h-6 w-28" />
          <Shimmer className="mt-1.5 h-4 w-96 max-w-full" />
        </div>
      )}
      <div className="grid items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1 lg:items-stretch">
        <Card>
          <div className="h-[53px] shrink-0 animate-pulse border-b border-line-soft bg-sunken" />
          <div className="space-y-3.5 p-5">
            <Shimmer className="h-40 w-full rounded-2xl" />
            <Shimmer className="h-32 w-full rounded-2xl" />
            <Shimmer className="h-28 w-full rounded-2xl" />
          </div>
        </Card>
        <Card>
          <div className="h-[53px] shrink-0 animate-pulse border-b border-line-soft bg-sunken" />
          <div className="space-y-2.5 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Shimmer key={i} className="h-16 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </Frame>
  );
}

/** Admin, Resources: heading, the section strip, one settings card. */
export function SettingsPageSkeleton({ tabs }: { tabs: number }) {
  return (
    <Frame className="max-w-5xl">
      <Heading />
      <Tabs count={tabs} />
      <Card className="p-5">
        <Shimmer className="h-5 w-40" />
        <Shimmer className="mt-2 h-4 w-96 max-w-full" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Shimmer key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    </Frame>
  );
}

/** Batch record: the search box, then the record's card. */
export function SearchPageSkeleton() {
  return (
    <Frame className="max-w-6xl gap-4">
      <Shimmer className="h-12 w-full rounded-2xl" />
      <Card>
        <div className="h-[92px] shrink-0 animate-pulse border-b border-line bg-sunken" />
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Shimmer key={i} className="h-14 w-full" />
          ))}
        </div>
      </Card>
    </Frame>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

/**
 * Sized like the pages: fills the shell's frame from `lg` up, so a skeleton
 * and the page replacing it occupy the same box.
 */
function Frame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col lg:min-h-0 lg:flex-1",
        className,
      )}
      aria-busy
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** Kicker, title and blurb — the heading most workspaces open with. */
function Heading({ actions = 0 }: { actions?: number }) {
  return (
    <div className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div>
        <Shimmer className="h-3 w-16 rounded-md" />
        <Shimmer className="mt-2.5 h-7 w-56" />
        <Shimmer className="mt-2 h-4 w-80 max-w-full" />
      </div>
      {actions > 0 && (
        <div className="flex gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Shimmer key={i} className="h-10 w-28" />
          ))}
        </div>
      )}
    </div>
  );
}

/** A segmented strip the width of `count` pills. */
function Tabs({ count, className }: { count: number; className?: string }) {
  return (
    <div
      className={cn(
        "mb-5 flex w-fit shrink-0 gap-1 rounded-xl border border-line bg-sunken-2 p-1",
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-[30px] w-24 animate-pulse rounded-lg bg-surface/70"
        />
      ))}
    </div>
  );
}

function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1",
        className,
      )}
    >
      {children}
    </div>
  );
}
