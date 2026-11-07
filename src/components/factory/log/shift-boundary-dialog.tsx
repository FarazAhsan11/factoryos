"use client";

import { useCallback, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ShiftBoundaryItem {
  key: string;
  /** Which line it is, where there can be several — the grid's room name. */
  label?: string;
  /** From `shiftBoundaryWarning`. */
  message: string;
}

/**
 * Asked before filing an entry whose clocks leave its shift
 * (`shiftBoundaryWarning`). It asks, it never refuses: Log anyway files the
 * entry exactly as typed, Go back files nothing and leaves the typing put.
 *
 * Open while `items` is non-null. Escape and the backdrop are Go back.
 */
export function ShiftBoundaryDialog({
  items,
  onConfirm,
  onCancel,
}: {
  items: ShiftBoundaryItem[] | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const many = (items?.length ?? 0) > 1;

  return (
    <Dialog
      open={items !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-ink">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-warn-soft text-warn-deep">
              <TriangleAlert className="size-4" aria-hidden />
            </span>
            {many
              ? `${items?.length} entries fall outside their shift`
              : "This entry falls outside its shift"}
          </DialogTitle>
          <DialogDescription>
            Check the times before logging. Do you still want to log{" "}
            {many ? "these entries" : "this entry"}?
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 rounded-xl border border-warn-line bg-warn-tint p-3 text-[0.8125rem] leading-snug text-warn-ink">
          {items?.map((item) => (
            <li key={item.key}>
              {item.label && (
                <strong className="font-semibold">{item.label}: </strong>
              )}
              {item.message}
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98]"
          >
            <Check className="size-4" aria-hidden />
            Log anyway
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The question as a promise: `await ask(items)` is true for Log anyway, false
 * for Go back. Render `dialog` anywhere in the component. Awaited inside a
 * submit handler, it keeps the form submitting — and its button disabled —
 * until the answer is in, so the entry cannot be filed twice meanwhile.
 */
export function useShiftBoundaryConfirm() {
  const [pending, setPending] = useState<{
    items: ShiftBoundaryItem[];
    resolve: (ok: boolean) => void;
  } | null>(null);

  const ask = useCallback(
    (items: ShiftBoundaryItem[]) =>
      new Promise<boolean>((resolve) => setPending({ items, resolve })),
    [],
  );
  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const dialog = (
    <ShiftBoundaryDialog
      items={pending?.items ?? null}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  );
  return { ask, dialog };
}
