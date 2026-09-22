"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, type DefaultValues } from "react-hook-form";
import { CheckCircle2, Link2, Loader2, Lock, Package } from "lucide-react";
import { toast } from "sonner";

import {
  closeDeviationSchema,
  type CloseDeviationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { BatchSummary } from "@/components/factory/batch/batch-summary";
import { useCapaOptions } from "@/components/factory/deviations/use-capa-options";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { STAGE_LABELS, canReview } from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  DISPOSITIONS,
  STATUS_LABELS,
  STATUS_PILL,
  closeDeviation,
  deviationKeys,
  dispositionMeta,
  typeMeta,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { formatStamp } from "@/lib/factory/maintenance-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

const AREA =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

/** Quarantine is a hold while QA decides — never the decision it closes on. */
const FINAL_DISPOSITIONS = DISPOSITIONS.filter((d) => d.value !== "quarantine");

/**
 * One deviation or NCR in full, with the close form underneath while it is
 * open. Opened from the register and from the batch record alike, so a
 * record is closed the same way wherever it is found.
 */
export function DeviationDetailDialog({
  deviation,
  factoryId,
  role,
  onClose,
}: {
  deviation: Deviation | null;
  factoryId: string;
  role: FactoryRole;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={deviation !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {/* Keyed, so a half-typed closing note never leaks between records. */}
        {deviation && (
          <Body
            key={deviation.id}
            deviation={deviation}
            factoryId={factoryId}
            role={role}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  deviation,
  factoryId,
  role,
  onClose,
}: {
  deviation: Deviation;
  factoryId: string;
  role: FactoryRole;
  onClose: () => void;
}) {
  const meta = typeMeta(deviation.type);
  const disposition = deviation.disposition
    ? dispositionMeta(deviation.disposition)
    : null;

  return (
    <>
      <DialogHeader className="shrink-0 gap-2 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="bg-sunken-2 font-mono text-ink-3">
            {deviation.deviation_no}
          </Badge>
          <Badge className={meta.pill}>{meta.label}</Badge>
          {disposition && (
            <Badge className={disposition.pill}>{disposition.label}</Badge>
          )}
          <Badge className={STATUS_PILL[deviation.status]}>
            {STATUS_LABELS[deviation.status]}
          </Badge>
        </div>

        <DialogTitle className="text-base leading-snug text-ink">
          {deviation.batch_no ? (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono">{deviation.batch_no}</span>
              {deviation.product_name && (
                <span className="font-normal text-ink-3">
                  {deviation.product_name}
                </span>
              )}
            </span>
          ) : (
            `${meta.label} — no batch`
          )}
        </DialogTitle>
        <DialogDescription className="text-xs">
          Raised {formatStamp(deviation.created_at)}
          {deviation.raised_by && ` by ${deviation.raised_by}`}
        </DialogDescription>
      </DialogHeader>

      <div className="scrollbar-slim min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {deviation.is_quarantining && (
          <p className="flex items-start gap-2 rounded-xl border border-danger-line bg-danger-soft px-3.5 py-2.5 text-xs text-danger-deep">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            Batch {deviation.batch_no} is on hold under this NCR. Preparatory
            and production work can&apos;t be logged against it until it is
            closed; downtime still can.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-3">
          <Fact label="Type">{meta.label}</Fact>
          <Fact label="Raised by">
            {deviation.raised_by ?? <Muted>Not recorded</Muted>}
          </Fact>
          <Fact label="QA reviewer">
            {deviation.qa_reviewer ?? <Muted>Not named</Muted>}
          </Fact>
          {disposition && (
            <Fact label={deviation.status === "closed" ? "Final disposition" : "Disposition"}>
              {disposition.label}
            </Fact>
          )}
          <Fact label="Linked CAPA">
            {deviation.action_title ? (
              <span className="inline-flex max-w-full items-center gap-1">
                <Link2 className="size-3.5 shrink-0 text-ink-5" />
                <span className="truncate">{deviation.action_title}</span>
                {deviation.action_status && (
                  <span className="shrink-0 text-ink-5">
                    · {STAGE_LABELS[deviation.action_status]}
                  </span>
                )}
              </span>
            ) : (
              <Muted>None</Muted>
            )}
          </Fact>
        </dl>

        {deviation.specification && (
          <Section label="Specification / requirement">
            <Prose>{deviation.specification}</Prose>
          </Section>
        )}

        <Section label="What actually happened">
          <Prose>{deviation.actual}</Prose>
        </Section>

        {deviation.impact && (
          <Section label="Potential impact on product quality">
            <Prose>{deviation.impact}</Prose>
          </Section>
        )}

        {deviation.batch_no && (
          <Section label="Batch">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <Package className="size-4 shrink-0 translate-y-0.5 text-ink-5" />
              <span className="font-mono font-semibold text-ink">
                {deviation.batch_no}
              </span>
              {deviation.product_code && (
                <span className="font-mono text-xs text-ink-5">
                  {deviation.product_code}
                </span>
              )}
            </p>
            <BatchSummary factoryId={factoryId} batchNo={deviation.batch_no} />
          </Section>
        )}

        <div className="border-t border-dashed border-line pt-5">
          {deviation.status === "closed" ? (
            <ClosedOut deviation={deviation} />
          ) : canReview(role) ? (
            <CloseForm deviation={deviation} factoryId={factoryId} />
          ) : (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center">
              <p className="text-sm text-ink-4">
                A supervisor or above closes this with QA.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 justify-end border-t border-line bg-surface px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="h-9 shrink-0 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
        >
          Close
        </button>
      </div>
    </>
  );
}

/* ── The gate ─────────────────────────────────────────────────────────── */

function CloseForm({
  deviation,
  factoryId,
}: {
  deviation: Deviation;
  factoryId: string;
}) {
  const queryClient = useQueryClient();
  const capaGroups = useCapaOptions(factoryId);
  const isNcr = deviation.type === "ncr";

  const defaults: DefaultValues<CloseDeviationValues> = {
    isNcr,
    // The decision raised with carries over, unless it was the hold itself —
    // closing on quarantine is exactly what the gate refuses.
    disposition:
      deviation.disposition && deviation.disposition !== "quarantine"
        ? deviation.disposition
        : "",
    closingNote: "",
    qaSignName: deviation.qa_reviewer ?? "",
    actionId: deviation.action_id ?? "",
  };

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CloseDeviationValues>({
    resolver: zodResolver(closeDeviationSchema),
    defaultValues: defaults,
  });

  const close = useMutation({
    mutationFn: (values: CloseDeviationValues) =>
      closeDeviation(deviation, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      });
      if (deviation.is_quarantining) {
        // The card's quarantine chip goes; its hold does not.
        await queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        });
        toast.success(
          `${deviation.deviation_no} closed. Batch ${deviation.batch_no} stays on hold until the next preparatory or production entry.`,
        );
      } else {
        toast.success(`${deviation.deviation_no} closed.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={handleSubmit((v) => close.mutateAsync(v).catch(() => {}))}
      className="space-y-4"
    >
      <div className="rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="text-sm font-semibold text-ink">
          Close {isNcr ? "the NCR" : "the deviation"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-4">
          {isNcr
            ? "Record what finally happened to the material and sign it off. Once closed, the record can't be edited."
            : "Record the outcome and sign it off. Once closed, the record can't be edited."}
        </p>
      </div>

      {isNcr && (
        <Field
          label="Final disposition"
          error={errors.disposition?.message}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {FINAL_DISPOSITIONS.map((d) => (
              <label
                key={d.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:ring-2 has-[:checked]:ring-brand/15"
              >
                <input
                  type="radio"
                  value={d.value}
                  {...register("disposition")}
                  className="mt-0.5 size-4 accent-brand"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {d.label}
                  </span>
                  <span className="block text-[11px] text-ink-5">{d.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}

      <Field label="Closing note" error={errors.closingNote?.message}>
        <textarea
          {...register("closingNote")}
          rows={3}
          placeholder="Final outcome, actions taken…"
          aria-invalid={Boolean(errors.closingNote)}
          className={AREA}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="QA reviewer sign-off"
          hint="Typed, and stamped with the time."
          error={errors.qaSignName?.message}
        >
          <input
            {...register("qaSignName")}
            placeholder="QA manager name"
            aria-invalid={Boolean(errors.qaSignName)}
            className={CONTROL}
          />
        </Field>

        <Field label="Link to CAPA" hint="(optional)">
          <Controller
            name="actionId"
            control={control}
            render={({ field }) => (
              <SelectField
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                clearable
                clearLabel="No CAPA"
                placeholder="None"
                searchPlaceholder="Issue title or batch…"
                emptyMessage="No issues raised yet."
                groups={capaGroups}
              />
            )}
          />
        </Field>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-deep px-4 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60"
      >
        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
        Close {deviation.deviation_no}
      </button>
    </form>
  );
}

function ClosedOut({ deviation }: { deviation: Deviation }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-teal-line bg-teal-soft px-4 py-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" />
        <div>
          <p className="text-sm font-semibold text-teal-deep">
            Closed by {deviation.qa_sign_name}
          </p>
          <p className="text-xs text-teal-deep/80">
            {formatStamp(deviation.closed_at)}
          </p>
        </div>
      </div>
      {deviation.closing_note && (
        <Section label="Closing note">
          <Prose>{deviation.closing_note}</Prose>
        </Section>
      )}
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ink-3">
        {label}
        {hint && <span className="ml-1.5 font-normal text-ink-5">{hint}</span>}
      </p>
      {children}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <p className="text-[10px] font-bold tracking-[0.07em] text-ink-4 uppercase">
        {label}
      </p>
      {children}
    </section>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">
      {children}
    </p>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[13px] text-ink">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="italic text-ink-5">{children}</span>;
}

function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1 ring-current/15",
        className,
      )}
    >
      {children}
    </span>
  );
}
