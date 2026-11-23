"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ncrInitiationSchema,
  parseBatches,
  type NcrInitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import { NcrInitiationFields } from "@/components/factory/deviations/ncr-initiation-fields";
import { PendingAttachments } from "@/components/factory/deviations/pending-attachments";
import { uploadAttachment } from "@/lib/factory/attachment-queries";
import { formatDateTime } from "@/lib/factory/dates";
import {
  deviationKeys,
  isoToLocal,
  raiseNcr,
} from "@/lib/factory/deviation-queries";
import { isMaterialItem, parseLots } from "@/lib/factory/ncr";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useForm } from "@/lib/use-form";
import { useClientClock } from "@/lib/use-render-clock";

/** The reference's starting answers: raw material, incoming inspection, quarantine Yes. */
const BLANK: NcrInitiationValues = {
  ncItem: "Raw material",
  ncItemOther: "",
  title: "",
  suppliedBy: "supplier",
  materialCode: "",
  supplierName: "",
  lots: "",
  qtyAffected: "",
  batches: "",
  detectionPoint: "Incoming inspection",
  occurredAt: "",
  departmentId: "",
  location: "",
  specification: "",
  actual: "",
  immediateAction: "",
  hold: "yes",
  holdNotReason: "",
  equipmentNo: "",
  sopNumber: "",
};

/** "18 Nov 2026, 22:30" — now, to the minute. */
const nowLabel = () =>
  formatDateTime(new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString());

/**
 * Raise a non-conformance — a page of its own, as the reference QMS
 * (qms-v12) has it: Non-conformances / New, the form, then Raise · Cancel ·
 * who and when. Raising opens the new NCR's page.
 */
export function RaiseNcrPage({
  factoryId,
  slug,
  userId,
  viewerName,
}: {
  factoryId: string;
  slug: string;
  userId: string;
  /** Recorded as "Raised by". */
  viewerName: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const listHref = `/factory/${slug}/deviations?tab=ncr`;
  const raisedAt = useClientClock(nowLabel, "");
  const [files, setFiles] = useState<File[]>([]);

  const form = useForm<NcrInitiationValues>({
    resolver: zodResolver(ncrInitiationSchema),
    defaultValues: BLANK,
  });

  // "Date found" starts at now — read here, not in render.
  useEffect(() => {
    if (!form.getValues("occurredAt")) {
      form.setValue("occurredAt", isoToLocal(new Date().toISOString()));
    }
  }, [form]);

  const raise = useMutation({
    mutationFn: async (values: NcrInitiationValues) => {
      // A held batch must be in the register; said here first, in the
      // database's words, before the round trip. A lot need not be.
      const batches = values.ncItem === "Other" ? [] : parseBatches(values.batches);
      if (values.hold === "yes" && batches.length > 0) {
        const products = await queryClient.ensureQueryData({
          queryKey: productKeys.all(factoryId),
          queryFn: () => fetchProducts(factoryId),
        });
        const known = new Set(products.map((p) => p.batch_no.toLowerCase()));
        const missing = batches.filter((b) => !known.has(b.toLowerCase()));
        if (missing.length > 0) {
          throw new Error(
            `Holding a batch — ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in the product register.`,
          );
        }
      }
      const raised = await raiseNcr(factoryId, values, userId, viewerName);

      const failed: string[] = [];
      for (const file of files) {
        try {
          await uploadAttachment({
            factoryId,
            deviationId: raised.id,
            section: "details",
            file,
            uploadedBy: userId,
            uploadedByName: viewerName,
          });
        } catch (e) {
          failed.push((e as Error).message);
        }
      }
      return { ...raised, failed };
    },
    onSuccess: async (raised, values) => {
      await queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      });
      if (values.hold === "yes") {
        await queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        });
        const held = isMaterialItem(values.ncItem)
          ? `lot ${parseLots(values.lots).join(", ")} in quarantine`
          : values.ncItem === "Other"
            ? "on hold"
            : `${parseBatches(values.batches).join(", ")} on hold`;
        toast.success(`${raised.deviation_no} raised — ${held}.`);
      } else {
        toast.success(`${raised.deviation_no} raised.`);
      }
      raised.failed.forEach((m) =>
        toast.error(`Not attached — ${m} Add it on the case's Details tab.`),
      );
      router.push(`/factory/${slug}/deviations/${raised.id}?tab=ncr`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { isSubmitting } = form.formState;

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-4">
        <Link href={listHref} className="text-brand hover:underline">
          Non-conformances
        </Link>
        <span className="mx-1.5 text-ink-5">/</span>
        <span>New</span>
      </nav>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        New non-conformance
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-4">
        Material or product that does not meet its specification. QA
        classifies it and sets the owner and due date at the initial
        assessment.
      </p>

      <form
        noValidate
        onSubmit={form.handleSubmit(
          (values) => raise.mutateAsync(values).catch(() => {}),
          () =>
            requestAnimationFrame(() =>
              document
                .querySelector('main [role="alert"]')
                ?.scrollIntoView({ block: "center", behavior: "smooth" }),
            ),
        )}
        className="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-7"
      >
        <NcrInitiationFields form={form} factoryId={factoryId} />

        <div className="mt-7 border-t border-line-soft pt-6">
          <PendingAttachments
            files={files}
            onChange={setFiles}
            disabled={isSubmitting}
          />
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
          <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Raise non-conformance
          </button>
          <Link href={listHref} className={SECONDARY_BUTTON}>
            Cancel
          </Link>
          <span className="text-[0.8125rem] text-ink-4">
            Raised by {viewerName || "you"}
            {raisedAt && ` · ${raisedAt}`}
          </span>
        </div>
      </form>
    </div>
  );
}
