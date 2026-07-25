import { cn } from "@/lib/utils";

/** Shared shimmer block for route-level loading states. */
export function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-xl bg-[#EAEEF5]", className)} />
  );
}

/**
 * Placeholder for a factory page body. Rendered by loading.tsx while the
 * segment streams in — the shell and sidebar stay put, only this area swaps.
 */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-5xl" aria-busy aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Shimmer className="h-3.5 w-16" />
      <Shimmer className="mt-3 h-7 w-64" />
      <Shimmer className="mt-2.5 h-4 w-80" />
      <Shimmer className="mt-6 h-12 w-full" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Shimmer key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
