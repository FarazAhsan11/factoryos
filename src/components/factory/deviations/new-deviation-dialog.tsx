"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { type DefaultValues } from "react-hook-form";
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
import {
  createDeviation,
  type DeviationType,
} from "@/lib/factory/deviation-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useForm } from "@/lib/use-form";

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
  immediateActionDate: "",
  immediateAction: "",
  disposition: "",
  actionId: "",
  receivedVia: "",
  adverseReaction: "",
};

/** The blank case for one screen: its type preset when it has only one. */
function emptyFor(types: DeviationType[]): DefaultValues<InitiationValues> {
  return { ...EMPTY_CASE, type: types.length === 1 ? types[0] : undefined };
}

/**
 * Raise a case — tab 1 of the record, and only tab 1.
 *
 * Raised from one Quality screen, so it offers only that screen's types: a
 * deviation is planned or unplanned (asked), a non-conformance and a
 * complaint are what the screen says they are (preset, not asked).
 *
 * The other six are filled as the facts arrive: an investigation's findings
 * are not known at the moment somebody notices tablets going soft. Asking for
 * them here would either be ignored or invented.
 */
export function NewDeviationDialog({
  factoryId,
  userId,
  types,
  buttonLabel,
  title,
  onCreated,
}: {
  factoryId: string;
  userId: string;
  /** The case types this screen raises. */
  types: DeviationType[];
  buttonLabel: string;
  title: string;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const blank = emptyFor(types);

  const form = useForm<InitiationValues>({
    resolver: zodResolver(initiationSchema),
    defaultValues: blank,
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
      form.reset(blank);
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
          form.reset(blank);
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
      >
        <Plus className="size-4" />
        {buttonLabel}
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
              {title}
            </DialogTitle>
            <DialogDescription>
              Initiation and identification — the case is numbered when it is
              raised. The risk, investigation and CAPA tabs are filled as the
              case is worked.
            </DialogDescription>
          </DialogHeader>

          <form
            // Awaited so the button stays disabled for the round-trip; the
            // failure is already a toast, so it is not rethrown.
            onSubmit={form.handleSubmit(
              (values) => create.mutateAsync(values).catch(() => {}),
              // A refused field can sit a long scroll above the button —
              // bring the first error into view rather than seem to do nothing.
              () =>
                requestAnimationFrame(() =>
                  document
                    .querySelector('[role="dialog"] [role="alert"]')
                    ?.scrollIntoView({ block: "center", behavior: "smooth" }),
                ),
            )}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <InitiationFields
                form={form}
                factoryId={factoryId}
                types={types}
              />
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
