"use client";

import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ncrInitiationSchema,
  parseBatches,
  type NcrInitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { PRIMARY_BUTTON } from "@/components/factory/deviations/deviation-fields";
import { NcrInitiationFields } from "@/components/factory/deviations/ncr-initiation-fields";
import {
  completeNcrInitiation,
  deviationKeys,
  ncrInitiationValues,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { holdKeys, placeHolds, placeLots } from "@/lib/factory/hold-queries";
import { isMaterialItem, parseLots } from "@/lib/factory/ncr";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { useForm } from "@/lib/use-form";

/**
 * An NCR raised before the qms-v12 form (0078) has answers the initial
 * assessment demands but the old form never asked — detected at, date found,
 * department, requirement, immediate action, the hold question. Its Details
 * tab asks them here, on the raise form's own fields, until they are given;
 * then the case reads as any other NCR's. A Yes places the holds.
 */
export function NcrCompleteDetails({
  deviation: d,
  factoryId,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<NcrInitiationValues>({
    resolver: zodResolver(ncrInitiationSchema),
    defaultValues: ncrInitiationValues(d),
  });

  async function save(v: NcrInitiationValues) {
    try {
      await completeNcrInitiation(d.id, v);
      if (v.hold === "yes" && d.hold_batch !== true) {
        if (isMaterialItem(v.ncItem) && parseLots(v.lots).length > 0) {
          await placeLots(d.id, parseLots(v.lots), viewerName);
        }
        if (v.ncItem !== "Other" && parseBatches(v.batches).length > 0) {
          await placeHolds(d.id, parseBatches(v.batches), viewerName);
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) }),
        queryClient.invalidateQueries({ queryKey: holdKeys.forCase(factoryId, d.id) }),
        queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
      ]);
      toast.success(`${d.deviation_no}'s details completed.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(save, () =>
        requestAnimationFrame(() =>
          document
            .querySelector('main [role="alert"]')
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        ),
      )}
      className="space-y-6"
    >
      <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-sm text-warn-ink">
        {d.deviation_no} was raised on the earlier form. Complete what the
        non-conformance form asks — the initial assessment needs it. Check the
        date found: it starts at the day it was raised.
      </p>
      <NcrInitiationFields form={form} factoryId={factoryId} caseId={d.id} />
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
        <button type="submit" disabled={form.formState.isSubmitting} className={PRIMARY_BUTTON}>
          {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Save details
        </button>
        <span className="text-[0.8125rem] text-ink-4">
          Once the initial assessment is signed, the details are fixed.
        </span>
      </div>
    </form>
  );
}
