import { Beaker, Package, RefreshCw } from "lucide-react";

import {
  BATCH_TYPES,
  type BatchType,
} from "@/app/factory/[slug]/pipeline/schemas";
import { cn } from "@/lib/utils";

/**
 * What kind of batch this is, in one pill.
 *
 * One component rather than a class string repeated on the Kanban card, the
 * families view and the shift log's batch panel — the three places a batch's
 * type has to read the same way, since a planner moves between them inside a
 * single decision.
 *
 * The icon and colour live here and the wording lives in `BATCH_TYPES`, so
 * the type cards in the New batch dialog and every badge downstream are
 * naming the same three things from one array.
 */
const STYLES: Record<
  BatchType,
  { icon: typeof Package; className: string; ring: string }
> = {
  manufacturing: {
    icon: Beaker,
    className: "bg-warn-tint text-warn-ink",
    ring: "ring-warn-line/70",
  },
  packing: {
    icon: Package,
    className: "bg-brand-soft text-brand-deep",
    ring: "ring-brand-line/70",
  },
  combined: {
    icon: RefreshCw,
    className: "bg-teal-soft text-teal-deep",
    ring: "ring-teal-line/70",
  },
};

export function BatchTypeBadge({
  type,
  /** Appended after the label — "Packing · 60 · AU". */
  detail,
  className,
}: {
  type: BatchType;
  detail?: string;
  className?: string;
}) {
  const style = STYLES[type] ?? STYLES.combined;
  const Icon = style.icon;
  const label = BATCH_TYPES.find((t) => t.value === type)?.label ?? type;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-[0.02em] uppercase ring-1",
        style.className,
        style.ring,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
      {detail && <span className="font-semibold normal-case">· {detail}</span>}
    </span>
  );
}

/**
 * The "← 46000 bulk" line under a packing card.
 *
 * Renders nothing when the batch has no parent, so a caller can drop it in
 * without first working out whether this card is part of a family.
 */
export function ParentBatchLink({
  batchNo,
  className,
}: {
  batchNo: string | null;
  className?: string;
}) {
  if (!batchNo) return null;
  return (
    <p
      className={cn(
        "font-mono text-[10px] font-semibold text-brand",
        className,
      )}
      title={`Bulk from batch ${batchNo}`}
    >
      ← {batchNo} bulk
    </p>
  );
}
