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
        .some((field) => field!.toLowerCase().includes(term))
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
    mutationFn: () => createPipelineJobs(factoryId, [...picked], userId),
    onSuccess: (count) => {
      toast.success(
        `${count} job${count === 1 ? "" : "s"} added to Planned.`
      );
      reset();
      setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06]"
      >
        <Plus className="size-4" />
        New job
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#0F1B34]">
              Add jobs to the pipeline
            </DialogTitle>
            <DialogDescription>
              Pick the batches to start tracking. They land in Planned and move
              themselves as entries are logged against them.
            </DialogDescription>
          </DialogHeader>

          {available.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
              Every batch in the catalogue is already on the board.
              <br />
              Add more in Admin &amp; Settings → Products.
            </p>
          ) : (
            <div className="space-y-3">
              {available.length > 8 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by batch, code or product…"
                    aria-label="Search batches"
                    className="h-9 w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] pl-9 pr-3 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB]"
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-2 px-0.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#0F1B34]">
                  <input
                    type="checkbox"
                    checked={allVisiblePicked}
                    onChange={toggleAllVisible}
                    disabled={visible.length === 0}
                    className="size-4 cursor-pointer rounded border-[#CBD5E1] accent-[#2563EB]"
                  />
                  Select all
                  {search && visible.length !== available.length && (
                    <span className="text-xs font-normal text-[#94A3B8]">
                      ({visible.length} shown)
                    </span>
                  )}
                </label>
                <span className="text-xs text-[#64748B]">
                  {picked.size} selected
                </span>
              </div>

              <ul className="max-h-72 overflow-y-auto rounded-xl border border-[#E6EAF1]">
                {visible.length === 0 ? (
                  <li className="px-3.5 py-8 text-center text-xs text-[#94A3B8]">
                    Nothing matches “{search}”.
                  </li>
                ) : (
                  visible.map((product) => {
                    const on = picked.has(product.id);
                    return (
                      <li key={product.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-3 border-b border-[#F1F5F9] px-3.5 py-2.5 transition last:border-0",
                            on ? "bg-[#EFF6FF]" : "hover:bg-[#F8FAFC]"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(product.id)}
                            className="size-4 shrink-0 cursor-pointer rounded border-[#CBD5E1] accent-[#2563EB]"
                          />
                          <span className="shrink-0 font-mono text-[12px] font-medium text-[#0F1B34]">
                            {product.batch_no}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-[#334155]">
                            {product.name}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-[#64748B]">
                            {fmt(product.required_qty)}
                          </span>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={create.isPending}
                  className="h-10 rounded-xl px-4 text-sm font-medium text-[#475569] transition hover:bg-[#F1F5F9] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => create.mutate()}
                  disabled={picked.size === 0 || create.isPending}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
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
