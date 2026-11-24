"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  complaintInitiationSchema,
  type ComplaintInitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import { ComplaintInitiationFields } from "@/components/factory/deviations/complaint-initiation-fields";
import { PendingAttachments } from "@/components/factory/deviations/pending-attachments";
import { uploadAttachment } from "@/lib/factory/attachment-queries";
import { formatDateTime } from "@/lib/factory/dates";
import { deviationKeys, raiseComplaint } from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { useClientClock } from "@/lib/use-render-clock";

/** The reference's starting answers: received today (set on mount), Australia. */
const BLANK: ComplaintInitiationValues = {
  title: "",
  receivedOn: "",
  receivedVia: "",
  complainant: "",
  contact: "",
  country: "Australia",
  batches: "",
  productLabel: "",
  customerName: "",
  expiry: "",
  unitsAffected: "",
  actual: "",
  adverse: "",
  adverseWhat: "",
  serious: "",
  sample: "",
  sampleReceivedOn: "",
  immediateAction: "",
};

/** Today, `YYYY-MM-DD`, in the browser's zone. */
const todayKey = () => {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
};

/** "18 Nov 2026, 22:30" — now, to the minute. */
const nowLabel = () =>
  formatDateTime(new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString());

/**
 * Raise a customer complaint — a page of its own, as the reference QMS
 * (qms-v12) has it: Customer complaints / New, the form, attachments (photos,
 * the complainant's email), then Raise · Cancel · who and when. Raising opens
 * the new complaint's page.
 */
export function RaiseComplaintPage({
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
  const listHref = `/factory/${slug}/deviations?tab=complaints`;
  const raisedAt = useClientClock(nowLabel, "");
  const [files, setFiles] = useState<File[]>([]);

  const form = useForm<ComplaintInitiationValues>({
    resolver: zodResolver(complaintInitiationSchema),
    defaultValues: BLANK,
  });

  // "Date received" starts at today — read here, not in render.
  useEffect(() => {
    if (!form.getValues("receivedOn")) form.setValue("receivedOn", todayKey());
  }, [form]);

  const raise = useMutation({
    mutationFn: async (values: ComplaintInitiationValues) => {
      const raised = await raiseComplaint(factoryId, values, userId, viewerName);

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
      toast.success(
        values.serious === "yes"
          ? `${raised.deviation_no} raised — serious adverse reaction: a red flag, the case starts as Critical.`
          : `${raised.deviation_no} raised.`,
      );
      raised.failed.forEach((m) =>
        toast.error(`Not attached — ${m} Add it on the case's Details tab.`),
      );
      router.push(`/factory/${slug}/deviations/${raised.id}?tab=complaints`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { isSubmitting } = form.formState;

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-4">
        <Link href={listHref} className="text-brand hover:underline">
          Customer complaints
        </Link>
        <span className="mx-1.5 text-ink-5">/</span>
        <span>New</span>
      </nav>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        New customer complaint
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-4">
        Complaints from customers, distributors and consumers. QA classifies
        it and sets the owner and due date at the initial assessment.
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
        <ComplaintInitiationFields form={form} factoryId={factoryId} />

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
            Raise complaint
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
