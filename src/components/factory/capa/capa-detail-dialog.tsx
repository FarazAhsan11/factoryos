"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import {
  CAPA_REASONS,
  capaHeaderSchema,
  type CapaHeaderValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CapaPanel } from "@/components/factory/capa/capa-panel";
import {
  AREA,
  Badge,
  Cols,
  CONTROL,
  DateControl,
  Fact,
  Field,
  FooterSlotProvider,
  Group,
  Muted,
  SECONDARY_BUTTON,
  SaveBar,
  SelectControl,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canReview } from "@/lib/factory/action-queries";
import {
  CAPA_STATUS_LABELS,
  CAPA_STATUS_PILL,
  saveCapaHeader,
  type Capa,
} from "@/lib/factory/capa-queries";
import type { FactoryRole } from "@/lib/factory/context";
import { formatStamp } from "@/lib/factory/maintenance-queries";
import { deviationKeys, typeMeta } from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * One CAPA from the register: its header, the cases it covers, and the same
 * working surface the case's CAPA tab draws (`CapaPanel`).
 */
export function CapaDetailDialog({
  capa,
  factoryId,
  role,
  onClose,
  onOpenCase,
}: {
  capa: Capa | null;
  factoryId: string;
  role: FactoryRole;
  onClose: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  return (
    <Dialog
      open={capa !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0">
        {capa && (
          <Body
            key={capa.id}
            capa={capa}
            factoryId={factoryId}
            role={role}
            onClose={onClose}
            onOpenCase={onOpenCase}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  capa,
  factoryId,
  role,
  onClose,
  onOpenCase,
}: {
  capa: Capa;
  factoryId: string;
  role: FactoryRole;
  onClose: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  const readOnly = !canReview(role);
  const editable = !readOnly && capa.status === "open";
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <>
      <DialogHeader className="shrink-0 gap-2 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="bg-sunken-2 font-mono text-ink-3">
            {capa.capa_no}
          </Badge>
          <Badge className={CAPA_STATUS_PILL[capa.status]}>
            {CAPA_STATUS_LABELS[capa.status]}
          </Badge>
          {capa.reason && (
            <Badge className="bg-warn-soft text-warn-deep">{capa.reason}</Badge>
          )}
          {capa.is_overdue && (
            <Badge className="bg-danger-soft text-danger-deep">Overdue</Badge>
          )}
          {capa.actions_overdue > 0 && (
            <Badge className="bg-danger-soft text-danger-deep">
              {capa.actions_overdue} overdue
            </Badge>
          )}
        </div>
        <DialogTitle className="text-base leading-snug text-ink">
          {capa.title}
        </DialogTitle>
        <DialogDescription className="text-xs">
          raised {formatStamp(capa.created_at)}
          {capa.owner_name && ` · owner ${capa.owner_name}`}
        </DialogDescription>

        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-4">
          <span>Covers</span>
          {capa.cases.length === 0 ? (
            <Muted>no case</Muted>
          ) : (
            capa.cases.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => onOpenCase(k.id)}
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold ring-1 ring-current/15 transition hover:brightness-95",
                  typeMeta(k.type).pill,
                )}
              >
                {k.deviation_no}
              </button>
            ))
          )}
        </div>
      </DialogHeader>

      <FooterSlotProvider value={slot}>
      <div className="scrollbar-slim min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {editable ? (
          <HeaderForm capa={capa} factoryId={factoryId} />
        ) : (
          <Group title="CAPA">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fact label="Reason">{capa.reason ?? <Muted>—</Muted>}</Fact>
              <Fact label="CAPA owner">
                {capa.owner_name ?? <Muted>—</Muted>}
              </Fact>
              <Fact label="Target date">{formatDate(capa.target_date)}</Fact>
            </dl>
          </Group>
        )}

        <CapaPanel capa={capa} factoryId={factoryId} readOnly={readOnly} />
      </div>
      </FooterSlotProvider>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
        <div ref={setSlot} className="flex items-center gap-2" />
        <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
          Close
        </button>
      </div>
    </>
  );
}

/** The CAPA's own fields — editable while it is open, frozen once verified. */
function HeaderForm({ capa, factoryId }: { capa: Capa; factoryId: string }) {
  const queryClient = useQueryClient();
  const form = useForm<CapaHeaderValues>({
    resolver: zodResolver(capaHeaderSchema),
    defaultValues: {
      title: capa.title,
      owner: capa.owner_name ?? "",
      reason: (capa.reason ?? "") as CapaHeaderValues["reason"],
      targetDate: capa.target_date ?? "",
      effectivenessCriteria: capa.effectiveness_criteria ?? "",
      verifyBy: capa.verify_by ?? "",
    },
  });
  const save = useMutation({
    mutationFn: (v: CapaHeaderValues) => saveCapaHeader(capa.id, v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      });
      toast.success(`${capa.capa_no} saved.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3"
    >
      <Group title="CAPA">
        <Field
          label="CAPA title"
          htmlFor="capa-title"
          required
          error={errors.title?.message}
        >
          <input
            id="capa-title"
            aria-invalid={Boolean(errors.title)}
            className={CONTROL}
            {...form.register("title")}
          />
        </Field>
        <Cols>
          <Field label="Reason" htmlFor="capa-reason">
            <SelectControl
              control={form.control}
              name="reason"
              id="capa-reason"
              clearable
              clearLabel="Not recorded"
              placeholder="Why a CAPA…"
              options={CAPA_REASONS.map((r) => ({ value: r, label: r }))}
            />
          </Field>
          <Field label="CAPA owner" htmlFor="capa-owner">
            <input
              id="capa-owner"
              placeholder="Who owns the plan"
              className={CONTROL}
              {...form.register("owner")}
            />
          </Field>
          <Field label="Target date" htmlFor="capa-target">
            <DateControl
              control={form.control}
              name="targetDate"
              id="capa-target"
            />
          </Field>
        </Cols>
        <Cols of={2}>
          <Field
            label="Verify by"
            htmlFor="capa-verify-by"
            hint="When the effectiveness is checked."
          >
            <DateControl
              control={form.control}
              name="verifyBy"
              id="capa-verify-by"
            />
          </Field>
        </Cols>
        <Field
          label="Effectiveness criteria"
          htmlFor="capa-criteria-head"
          hint="What would show the CAPA worked — decided up front, checked at the end."
          error={errors.effectivenessCriteria?.message}
        >
          <textarea
            id="capa-criteria-head"
            rows={2}
            placeholder="e.g. Next 5 lots meet 13–16% moisture."
            className={AREA}
            {...form.register("effectivenessCriteria")}
          />
        </Field>
      </Group>
      <SaveBar pending={form.formState.isSubmitting} />
    </form>
  );
}
