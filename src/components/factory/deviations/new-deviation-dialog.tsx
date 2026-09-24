"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type DefaultValues } from "react-hook-form";
import { FileWarning, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  initiationSchema,
  type InitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { InitiationFields } from "@/components/factory/deviations/initiation-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createDeviation } from "@/lib/factory/deviation-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";

// `type` is left unset on purpose: which kind of case this is decides its
// number, and a pre-selected answer is one nobody gave.
export const EMPTY_CASE: DefaultValues<InitiationValues> = {
  type: undefined,
  title: "",
  priority: "medium",
  origin: "",
  ncCategory: "",
  slaDate: "",
  batchNo: "",
  customerName: "",
  customerOther: "",
  supplierName: "",
  ownerName: "",
  raisedBy: "",
  supervisorName: "",
  qaReviewer: "",
  procedureName: "",
  sopNumber: "",
  documentNumber: "",
  rawMaterialCode: "",
  rawMaterialName: "",
  packagingMaterialCode: "",
  equipmentNo: "",
  specification: "",
  actual: "",
  impact: "",
  disposition: "",
  actionId: "",
};

/**
 * Raise a case — tab 1 of the record, and only tab 1.
 *
 * The other six are filled as the facts arrive: an investigation's findings
 * are not known at the moment somebody notices tablets going soft. Asking for
 * them here would either be ignored or invented.
 */
export function NewDeviationDialog({
  factoryId,
  userId,
  onCreated,
}: {
  factoryId: string;
  userId: string;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const form = useForm<InitiationValues>({
    resolver: zodResolver(initiationSchema),
    defaultValues: EMPTY_CASE,
  });

  const create = useMutation({
    mutationFn: async (values: InitiationValues) => {
      // Refused by the database too; said here so it arrives before the
      // round-trip, in the same words.
      if (values.type === "ncr" && values.disposition === "quarantine") {
        const products = await queryClient.ensureQueryData({
          queryKey: productKeys.all(factoryId),
          queryFn: () => fetchProducts(factoryId),
        });
        const term = values.batchNo.trim().toLowerCase();
        if (!products.some((p) => p.batch_no.toLowerCase() === term)) {
          throw new Error(
            `Quarantine holds a batch — ${values.batchNo} is not one in the product register.`,
          );
        }
      }
      return createDeviation(factoryId, values, userId);
    },
    onSuccess: async (number, values) => {
      form.reset(EMPTY_CASE);
      setOpen(false);
      onCreated();
      if (values.type === "ncr" && values.disposition === "quarantine") {
        // The hold happened in the database; stop trusting the board we have.
        await queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        });
        toast.success(`${number} raised — batch ${values.batchNo} is on hold.`);
      } else {
        toast.success(`${number} raised.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { isSubmitting } = form.formState;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          form.reset(EMPTY_CASE);
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
      >
        <Plus className="size-4" />
        New case
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
            <DialogTitle className="flex items-center gap-2 text-ink">
              <FileWarning className="size-4 text-brand" />
              New deviation / NCR
            </DialogTitle>
            <DialogDescription>
              Initiation and identification — the case is numbered when it is
              raised (DEV for a deviation, NCR for a non-conformance). The
              containment, risk, investigation and action tabs are filled as
              the case is worked.
            </DialogDescription>
          </DialogHeader>

          <form
            // Awaited so the button stays disabled for the round-trip; the
            // failure is already a toast, so it is not rethrown.
            onSubmit={form.handleSubmit((values) =>
              create.mutateAsync(values).catch(() => {}),
            )}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <InitiationFields form={form} factoryId={factoryId} />
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
                className="h-10 rounded-xl px-4 text-sm font-semibold text-ink-3 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Raise case
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
