"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteFactory } from "@/app/admin/actions";
import {
  deleteFactorySchema,
  type DeleteFactoryValues,
} from "@/app/admin/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const FIELD =
  "h-11 w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#DC2626] focus:bg-white focus:ring-4 focus:ring-[#DC2626]/12";
const LABEL = "text-xs font-medium text-[#475569]";

export function DeleteFactoryDialog({
  factoryId,
  factoryName,
  onDeleted,
  className,
}: {
  factoryId: string;
  factoryName: string;
  onDeleted?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DeleteFactoryValues>({
    resolver: zodResolver(deleteFactorySchema),
    defaultValues: { factoryId, confirmName: "" },
  });

  async function onSubmit(values: DeleteFactoryValues) {
    setError(null);
    const result = await deleteFactory(values);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    if (result.warning) toast.warning(result.warning);
    else
      toast.success(
        `${factoryName} deleted — ${result.deletedUsers} user account(s) removed.`
      );

    setOpen(false);
    reset({ factoryId, confirmName: "" });
    onDeleted?.();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset({ factoryId, confirmName: "" });
          setError(null);
          setOpen(true);
        }}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-[#FECACA] bg-white px-3 text-sm font-medium text-[#B91C1C] transition hover:bg-[#FEF2F2]",
          className
        )}
      >
        <Trash2 className="size-4" />
        Delete factory
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#0F1B34]">
              Delete {factoryName}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the factory and everything scoped to it.
              It cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#991B1B]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <ul className="list-disc space-y-0.5 pl-4">
              <li>All user accounts belonging to this factory</li>
              <li>Their profiles and sign-in access</li>
              <li>The factory logo and its record</li>
            </ul>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <input type="hidden" {...register("factoryId")} />

            <div className="space-y-1.5">
              <label htmlFor="df-confirm" className={LABEL}>
                Type{" "}
                <span className="font-semibold text-[#0F1B34]">
                  {factoryName}
                </span>{" "}
                to confirm
              </label>
              <input
                id="df-confirm"
                autoComplete="off"
                placeholder={factoryName}
                aria-invalid={Boolean(errors.confirmName)}
                className={FIELD}
                {...register("confirmName")}
              />
              {errors.confirmName && (
                <p className="text-xs text-[#B91C1C]">
                  {errors.confirmName.message}
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 rounded-xl px-4 text-sm font-medium text-[#475569] transition hover:bg-[#F1F5F9]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#EF4444_0%,#DC2626_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(220,38,38,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {isSubmitting ? "Deleting…" : "Delete factory"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
