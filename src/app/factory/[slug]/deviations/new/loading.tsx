import { Shimmer } from "@/components/factory/page-skeleton";

/** Shaped like the raise page: breadcrumb, heading, then the form card. */
export default function NewDeviationLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <Shimmer className="h-4 w-32" />
      <Shimmer className="mt-3 h-7 w-48" />
      <Shimmer className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-5 grid gap-x-6 gap-y-5 rounded-2xl border border-line bg-surface p-5 sm:p-7 md:grid-cols-2">
        <Shimmer className="h-16 md:col-span-2" />
        {Array.from({ length: 6 }, (_, i) => (
          <Shimmer key={i} className="h-16" />
        ))}
        <Shimmer className="h-24 md:col-span-2" />
        <Shimmer className="h-24 md:col-span-2" />
      </div>
    </div>
  );
}
