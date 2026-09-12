"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDay } from "@/lib/factory/dates";
import { createPipelineJobs } from "@/lib/factory/pipeline-queries";
import type { Product } from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Adds jobs to the board from the batch catalogue.
 *
 * The list is only batches with **no job yet** — a batch is run once, so one
 * already on the board has nothing to add. That is also why the dialog needs
 * no fields: everything a card shows either comes from the product row
 * (batch, code, name, required qty) or is learned later from the shift log
 * (the room, the status, the progress). Asking for a room here would only
 * create something for the log to contradict.
 */
export function NewJobDialog({
  factoryId,
  userId,
  available,
  onCreated,
}: {
  factoryId: string;
  userId: string;
  /** Active products with no pipeline job — computed by the workspace. */
  available: Product[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return available;
    return available.filter((p) =>
      [p.batch_no, p.code, p.name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term)),
    );
  }, [available, search]);

  // Select-all acts on what's **visible**, not the whole catalogue: with a
  // search active, "select all" meaning "including the 200 you filtered out"
  // would be a genuinely destructive surprise.
  const allVisiblePicked =
    visible.length > 0 && visible.every((p) => picked.has(p.id));

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setPicked((current) => {
      const next = new Set(current);
      if (allVisiblePicked) visible.forEach((p) => next.delete(p.id));
      else visible.forEach((p) => next.add(p.id));
      return next;
    });
  }

  function reset() {
    setPicked(new Set());
    setSearch("");
  }

  const create = useMutation({
    mutationFn: () =>
      createPipelineJobs(
        factoryId,
        available.filter((p) => picked.has(p.id)),
        userId,
      ),
    onSuccess: (count) => {
      toast.success(`${count} job${count === 1 ? "" : "s"} added to Planned.`);
      reset();
      setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      {/* Secondary since batch families landed: New batch is the primary act
          now, and this one is the bulk path — twenty already-catalogued
          batches ticked off a list, which the typed form is the wrong shape
          for. Two gradient buttons side by side would say they are equals. */}
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-ink-6 hover:text-ink"
      >
        <Plus className="size-4" />
        From catalogue
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        {/* `p-0` and a flex column so the batch list is the only thing that
            scrolls — the dialog used to scroll as a whole *and* cap the list
            at 18rem, which put two scrollbars inside one box and could take
            "Add to Planned" off the bottom of the screen. */}
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
            <DialogTitle className="text-ink">
              Add jobs to the pipeline
            </DialogTitle>
            <DialogDescription>
              Pick the batches to start tracking. They land in Planned and move
              themselves as entries are logged against them.
            </DialogDescription>
          </DialogHeader>

          {available.length === 0 ? (
            <p className="m-5 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center text-sm text-ink-5">
              Every batch in the catalogue is already on the board.
              <br />
              Add more in Admin &amp; Settings → Products.
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 space-y-3 px-5 pt-4">
                {available.length > 8 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-5" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by batch, code or product…"
                      aria-label="Search batches"
                      className="h-9 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 px-0.5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={allVisiblePicked}
                      onChange={toggleAllVisible}
                      disabled={visible.length === 0}
                      className="size-4 cursor-pointer rounded border-ink-6 accent-brand"
                    />
                    Select all
                    {search && visible.length !== available.length && (
                      <span className="text-xs font-normal text-ink-5">
                        ({visible.length} shown)
                      </span>
                    )}
                  </label>
                  <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-4">
                    {picked.size} selected
                  </span>
                </div>
              </div>

              <ul className="scrollbar-slim mx-5 mt-3 min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface">
                {visible.length === 0 ? (
                  <li className="px-3.5 py-8 text-center text-xs text-ink-5">
                    Nothing matches “{search}”.
                  </li>
                ) : (
                  visible.map((product) => {
                    const on = picked.has(product.id);
                    return (
                      <li key={product.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-3 border-b border-line-soft px-3.5 py-2.5 transition last:border-0",
                            on ? "bg-brand-soft" : "hover:bg-sunken",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(product.id)}
                            className="size-4 shrink-0 cursor-pointer rounded border-ink-6 accent-brand"
                          />
                          <span className="shrink-0 font-mono text-[12px] font-medium text-ink">
                            {product.batch_no}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                            {product.name}
                          </span>
                          {/* Already scheduled, and shown rather than hidden:
                              a batch due on Thursday is still a legitimate
                              thing to start today. What a planner needs is to
                              know it was going to arrive on its own. */}
                          {product.planned_for && (
                            <span
                              title={`Scheduled to join Planned on ${product.planned_for}`}
                              className="shrink-0 rounded-full bg-violet-soft px-1.5 py-0.5 text-[10px] font-semibold text-violet-deep ring-1 ring-violet-line"
                            >
                              {formatDay(product.planned_for)}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-[11px] text-ink-4">
                            {fmt(product.required_qty)}
                          </span>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>

              <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={create.isPending}
                  className="h-10 rounded-xl px-4 text-sm font-semibold text-ink-3 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => create.mutate()}
                  disabled={picked.size === 0 || create.isPending}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
                >
                  {create.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Add {picked.size || ""} to Planned
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
