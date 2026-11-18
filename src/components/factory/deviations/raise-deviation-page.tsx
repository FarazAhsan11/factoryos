"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  deviationInitiationSchema,
  parseBatches,
  type DeviationInitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { DeviationInitiationFields } from "@/components/factory/deviations/deviation-initiation-fields";
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import { formatDateTime } from "@/lib/factory/dates";
import {
  deviationKeys,
  isoToLocal,
  raiseDeviation,
} from "@/lib/factory/deviation-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useForm } from "@/lib/use-form";
import { useClientClock } from "@/lib/use-render-clock";

const BLANK: DeviationInitiationValues = {
  type: "unplanned",
  title: "",
  occurredAt: "",
  departmentId: "",
  location: "",
  detectionPoint: "",
  batches: "",
  actual: "",
  immediateAction: "",
  hold: "",
  equipmentNo: "",
  procedureName: "",
  sopNumber: "",
  priority: "medium",
  slaDate: "",
  ownerName: "",
  supervisorName: "",
};

/** "18 Nov 2026, 22:30" — now, to the minute. */
const nowLabel = () =>
  formatDateTime(new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString());

/**
 * Raise a deviation — a page of its own, not a modal, as the reference QMS
 * has it: Deviations / New, the form, then Raise · Cancel · who and when.
 *
 * Only a deviation's first section is asked here. Priority, due date and
 * owner are set on the case once it is raised; the risk, investigation, CAPA
 * and close-out follow on its tabs. Raising opens the new case.
 */
export function RaiseDeviationPage({
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
  const listHref = `/factory/${slug}/deviations`;
  const raisedAt = useClientClock(nowLabel, "");

  const form = useForm<DeviationInitiationValues>({
    resolver: zodResolver(deviationInitiationSchema),
    defaultValues: BLANK,
  });

  // "When it happened" starts at now — read here, not in render, so the
  // server's clock and zone never reach the form.
  useEffect(() => {
    if (!form.getValues("occurredAt")) {
      form.setValue("occurredAt", isoToLocal(new Date().toISOString()));
    }
  }, [form]);

  const raise = useMutation({
    mutationFn: async (values: DeviationInitiationValues) => {
      // The database refuses a hold on a batch it doesn't know; said here
      // first, in its words, before the round trip.
      if (values.hold === "yes") {
        const products = await queryClient.ensureQueryData({
          queryKey: productKeys.all(factoryId),
          queryFn: () => fetchProducts(factoryId),
        });
        const known = new Set(products.map((p) => p.batch_no.toLowerCase()));
        const missing = parseBatches(values.batches).filter(
          (b) => !known.has(b.toLowerCase()),
        );
        if (missing.length > 0) {
          throw new Error(
            `Holding a batch — ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in the product register.`,
          );
        }
      }
      return raiseDeviation(factoryId, values, userId, viewerName);
    },
    onSuccess: async (raised, values) => {
      await queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      });
      if (values.hold === "yes") {
        // The hold happened in the database; stop trusting the board we have.
        await queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        });
        toast.success(
          `${raised.deviation_no} raised — ${parseBatches(values.batches).join(", ")} on hold.`,
        );
      } else {
        toast.success(`${raised.deviation_no} raised.`);
      }
      router.push(`${listHref}?case=${raised.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { isSubmitting } = form.formState;

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-4">
        <Link href={listHref} className="text-brand hover:underline">
          Deviations
        </Link>
        <span className="mx-1.5 text-ink-5">/</span>
        <span>New</span>
      </nav>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        New deviation
      </h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-4">
        Record what happened and what was done about it. Priority, owner and
        due date are set on the case once it is raised.
      </p>

      <form
        noValidate
        // Awaited so the button stays disabled for the round trip; the failure
        // is already a toast, so it is not rethrown.
        onSubmit={form.handleSubmit(
          (values) => raise.mutateAsync(values).catch(() => {}),
          // A refused field can sit a long scroll above the button.
          () =>
            requestAnimationFrame(() =>
              document
                .querySelector('main [role="alert"]')
                ?.scrollIntoView({ block: "center", behavior: "smooth" }),
            ),
        )}
        className="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-7"
      >
        <DeviationInitiationFields form={form} factoryId={factoryId} />

        <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
          <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Raise deviation
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
