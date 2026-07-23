import { cn } from "@/lib/utils";

/**
 * FactoryOS wordmark. Size it with `className` (e.g. `h-8`, `h-12`).
 * Reads the shared SVG from `public/branding/`.
 */
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/branding/logo-final.svg"
      alt="FactoryOS"
      className={cn("w-auto", className)}
    />
  );
}
