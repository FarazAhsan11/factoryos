import { Shimmer } from "@/components/factory/page-skeleton";

/** Shaped like the case page: breadcrumb, then the header card and its tabs. */
export default function DeviationCaseLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <Shimmer className="h-4 w-40" />
      <div className="mt-3 rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <Shimmer className="h-7 w-2/3" />
        <Shimmer className="mt-2 h-4 w-1/2" />
        <Shimmer className="mt-5 h-12 w-full" />
        <Shimmer className="mt-5 h-8 w-full" />
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Shimmer key={i} className="h-16" />
          ))}
        </div>
      </div>
    </div>
  );
}
