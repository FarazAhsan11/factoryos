import { statusMeta, type ProductStatus } from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

/**
 * A product's status in the board's own colours: Received in neutral, then
 * the colour of the pipeline column the batch is sitting in.
 */
export function ProductStatusChip({
  status,
  title,
  className,
}: {
  status: ProductStatus;
  title?: string;
  className?: string;
}) {
  const meta = statusMeta(status);
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap",
        className,
      )}
      style={{ background: meta.tint, color: meta.accent }}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: meta.accent }}
      />
      {meta.label}
    </span>
  );
}
