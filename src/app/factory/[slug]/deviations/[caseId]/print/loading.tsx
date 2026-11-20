import { Shimmer } from "@/components/factory/page-skeleton";

/** Shaped like the report: the back link and print button, then the document. */
export default function DeviationReportLoading() {
  return (
    <div className="mx-auto w-full max-w-[64rem]">
      <div className="flex items-center justify-between">
        <Shimmer className="h-4 w-32" />
        <Shimmer className="h-9 w-44" />
      </div>
      <div className="mt-3 rounded-2xl border border-line bg-surface p-5 sm:p-8">
        <Shimmer className="h-3 w-48" />
        <Shimmer className="mt-4 h-7 w-2/3" />
        <Shimmer className="mt-2 h-4 w-1/2" />
        <Shimmer className="mt-8 h-6 w-28" />
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Shimmer key={i} className="h-10" />
          ))}
        </div>
      </div>
    </div>
  );
}
