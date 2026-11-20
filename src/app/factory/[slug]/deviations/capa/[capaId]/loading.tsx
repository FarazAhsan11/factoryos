import { Shimmer } from "@/components/factory/page-skeleton";

/** Shaped like the CAPA page: breadcrumb, header with stepper, three step cards. */
export default function CapaLoading() {
  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <Shimmer className="h-4 w-48" />
      <div className="mt-3 rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <Shimmer className="h-7 w-2/3" />
        <Shimmer className="mt-2 h-4 w-1/2" />
        <Shimmer className="mt-5 h-6 w-3/4" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Shimmer key={i} className="h-16" />
          ))}
        </div>
      </div>
    </div>
  );
}
