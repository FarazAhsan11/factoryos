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
  "h-11 w-full rounded-xl border border-line bg-sunken px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-danger focus:bg-surface focus:ring-4 focus:ring-danger/12";
const LABEL = "text-xs font-medium text-ink-3";

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
        `${factoryName} deleted — ${result.deletedUsers} user account(s) removed.`,
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
          "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-danger-line bg-surface px-3 text-sm font-medium text-danger-deep transition hover:bg-danger-soft",
          className,
        )}
      >
        <Trash2 className="size-4" />
        Delete factory
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-ink">
              Delete {factoryName}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the factory and everything scoped to it.
              It cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2.5 rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger-deep">
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
                <span className="font-semibold text-ink">{factoryName}</span> to
                confirm
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
                <p className="text-xs text-danger-deep">
                  {errors.confirmName.message}
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-deep"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-danger)_0%,var(--color-danger)_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(220,38,38,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
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
