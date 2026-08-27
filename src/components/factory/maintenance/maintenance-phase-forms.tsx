"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  useWatch,
  type FieldValues,
  type Path,
  type UseFormRegister,
} from "react-hook-form";
import { CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import {
  maintenanceAssignSchema,
  maintenanceQaSchema,
  maintenanceWorkSchema,
  type MaintenanceAssignValues,
  type MaintenanceQaValues,
  type MaintenanceWorkValues,
} from "@/app/factory/[slug]/maintenance/schemas";
import { canReview } from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  assignMaintenance,
  completeMaintenanceWork,
  startMaintenanceWork,
  verifyMaintenance,
  type MaintenanceRequest,
} from "@/lib/factory/maintenance-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

const AREA =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

/**
 * The next thing this request needs, and nothing else.
 *
 * One form per gate, chosen by status. The alternative — every field on one
 * long page, greyed out until its turn — is what the paper form does, and the
 * reason a paper form comes back with Section 3 filled in before Section 2:
 * an editable box invites a pen, whatever the heading above it says.
 *
 * Each form sends the new status together with the evidence the gate asks
 * for, in one write. The database is the authority on whether that is enough;
 * these schemas exist so the answer arrives before the round-trip, not
 * instead of it.
 */
export function MaintenanceNextStep({
  request,
  factoryId,
  role,
  onDone,
}: {
  request: MaintenanceRequest;
  factoryId: string;
  role: FactoryRole;
  onDone: () => Promise<unknown> | void;
}) {
  if (request.status === "verified") {
    return (
      <div className="rounded-2xl border border-teal-line bg-teal-soft px-4 py-6 text-center shadow-[inset_0_1px_2px_rgb(13_148_136/0.06)]">
        <CheckCircle2 className="mx-auto mb-2 size-6 text-teal" />
        <p className="text-sm font-semibold text-teal-deep">
          All three sections are signed.
        </p>
        <p className="mt-1 text-xs text-teal-deep/80">
          {request.request_no} is complete. The record is on the other tabs.
        </p>
      </div>
    );
  }

  // Driving a request through its phases is the same standing that signs off
  // an issue — supervisor and up, mirroring `can_review_factory()`. Anyone can
  // raise one; not everyone can declare the work done.
  if (!canReview(role)) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center">
        <p className="text-sm text-ink-4">
          A supervisor or above moves this on.
        </p>
        <p className="mt-1 text-xs text-ink-5">
          You can follow it here — the record updates as each section is signed.
        </p>
      </div>
    );
  }

  switch (request.status) {
    case "reported":
      return (
        <AssignForm request={request} factoryId={factoryId} onDone={onDone} />
      );
    case "assigned":
      return <StartWork request={request} onDone={onDone} />;
    case "in_progress":
      return <WorkForm request={request} onDone={onDone} />;
    case "completed":
      return <QaForm request={request} onDone={onDone} />;
  }
}

/* ── Gate 1 · Reported → Assigned ─────────────────────────────────────── */

function AssignForm({
  request,
  factoryId,
  onDone,
}: {
  request: MaintenanceRequest;
  factoryId: string;
  onDone: () => Promise<unknown> | void;
}) {
  const { data: departments = [] } = useQuery({
    queryKey: setupKeys.all("factory_departments", factoryId),
    queryFn: () => fetchSetupItems("factory_departments", factoryId),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MaintenanceAssignValues>({
    resolver: zodResolver(maintenanceAssignSchema),
    defaultValues: {
      assignedTo: request.assigned_to ?? "",
      // Pre-filled from the request when the raiser already said which trade
      // was needed — which is usually, and re-asking would read as the app
      // not having listened.
      departmentId: request.department_id ?? "",
    },
  });

  const assign = useMutation({
    mutationFn: (values: MaintenanceAssignValues) =>
      assignMaintenance(request.id, values),
    onSuccess: async (_, values) => {
      await onDone();
      toast.success(`Assigned to ${values.assignedTo.trim()}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const active = departments.filter((d) => d.active);

  return (
    <form
      onSubmit={handleSubmit((v) => assign.mutateAsync(v))}
      className="space-y-4"
    >
      <Intro
        title="Open Section 2 — Engineering"
        body="Put a name on the work and confirm which department is doing it. Until someone owns it, this is a report rather than a job."
      />

      <Field label="Work assigned to" error={errors.assignedTo?.message}>
        <input
          {...register("assignedTo")}
          placeholder="Fitter, engineer or contractor"
          className={CONTROL}
          aria-invalid={!!errors.assignedTo}
        />
      </Field>

      <Field label="Department" error={errors.departmentId?.message}>
        <select {...register("departmentId")} className={CONTROL}>
          <option value="">Select a department…</option>
          {active.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {active.length === 0 && (
          <p className="text-xs text-warn-deep">
            No departments set up yet — add them in Admin → Departments.
          </p>
        )}
      </Field>

      <Submit pending={isSubmitting || assign.isPending}>Assign work</Submit>
    </form>
  );
}

/* ── Gate 2 · Assigned → In progress ──────────────────────────────────── */

function StartWork({
  request,
  onDone,
}: {
  request: MaintenanceRequest;
  onDone: () => Promise<unknown> | void;
}) {
  const start = useMutation({
    mutationFn: () => startMaintenanceWork(request.id),
    onSuccess: async () => {
      await onDone();
      toast.success("Work started — the downtime clock is running.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Intro
        title="Tools down?"
        body={`${request.assigned_to ?? "Someone"} has the job. Mark it started when work actually begins — that stamp is what makes the downtime figure mean the machine, rather than the paperwork.`}
      />

      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-deep px-4 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60"
      >
        {start.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <PlayCircle className="size-4" />
        )}
        Work started
      </button>
    </div>
  );
}

/* ── Gate 3 · In progress → Completed ─────────────────────────────────── */

function WorkForm({
  request,
  onDone,
}: {
  request: MaintenanceRequest;
  onDone: () => Promise<unknown> | void;
}) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MaintenanceWorkValues>({
    resolver: zodResolver(maintenanceWorkSchema),
    defaultValues: {
      workDetails: request.work_details ?? "",
      // Deliberately unset. Both questions are "delete one" on the paper form,
      // and a pre-selected "no" is an answer nobody gave.
      cleaningRequired: undefined,
      cleaningNote: "",
      productionReviewRequired: undefined,
      productionReviewBy: "",
    },
  });

  const cleaning = useWatch({ control, name: "cleaningRequired" });
  const review = useWatch({ control, name: "productionReviewRequired" });

  const complete = useMutation({
    mutationFn: (values: MaintenanceWorkValues) =>
      completeMaintenanceWork(request.id, values),
    onSuccess: async () => {
      await onDone();
      toast.success("Section 2 signed — the request is with QA.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={handleSubmit((v) => complete.mutateAsync(v))}
      className="space-y-4"
    >
      <Intro
        title="Sign Section 2 — the work carried out"
        body="What was done, and why it broke if that is known. Once this is signed the request goes to QA and the work record becomes part of the document."
      />

      <Field
        label="Details of maintenance work carried out"
        hint="Include reasons for breakdown if known."
        error={errors.workDetails?.message}
      >
        <textarea
          {...register("workDetails")}
          rows={5}
          placeholder="Replaced fibre optic sensor on the star wheel; original had failed intermittently since…"
          className={AREA}
          aria-invalid={!!errors.workDetails}
        />
      </Field>

      <Field
        label="Cleaning to be arranged after maintenance?"
        error={errors.cleaningRequired?.message}
      >
        <YesNo<MaintenanceWorkValues>
          name="cleaningRequired"
          register={register}
        />
        {cleaning === "yes" && (
          <input
            {...register("cleaningNote")}
            placeholder="What needs cleaning, and by whom (optional)"
            className={cn(CONTROL, "mt-2")}
          />
        )}
      </Field>

      <Field
        label="Production review of work required?"
        error={
          errors.productionReviewRequired?.message ??
          errors.productionReviewBy?.message
        }
      >
        <YesNo<MaintenanceWorkValues>
          name="productionReviewRequired"
          register={register}
        />
        {review === "yes" && (
          <input
            {...register("productionReviewBy")}
            placeholder="Who from Production signed the work off"
            className={cn(CONTROL, "mt-2")}
            aria-invalid={!!errors.productionReviewBy}
          />
        )}
      </Field>

      <Submit pending={isSubmitting || complete.isPending}>
        Sign off the work
      </Submit>
    </form>
  );
}

/* ── Gate 4 · Completed → Verified ────────────────────────────────────── */

function QaForm({
  request,
  onDone,
}: {
  request: MaintenanceRequest;
  onDone: () => Promise<unknown> | void;
}) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MaintenanceQaValues>({
    resolver: zodResolver(maintenanceQaSchema),
    defaultValues: {
      changeControlRequired: undefined,
      changeControlNo: "",
      deviationRaised: undefined,
      deviationNo: "",
      qaRemarks: "",
      qaSignName: "",
    },
  });

  const change = useWatch({ control, name: "changeControlRequired" });
  const deviation = useWatch({ control, name: "deviationRaised" });

  const verify = useMutation({
    mutationFn: (values: MaintenanceQaValues) =>
      verifyMaintenance(request.id, values),
    onSuccess: async () => {
      await onDone();
      toast.success("QA review recorded — the request is closed out.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={handleSubmit((v) => verify.mutateAsync(v))}
      className="space-y-4"
    >
      <Intro
        title="Section 3 — QA review"
        body="Two questions decide whether this breakdown was only a repair or also a quality event. Both take a reference number when the answer is yes."
      />

      <Field
        label="Change control required?"
        error={
          errors.changeControlRequired?.message ??
          errors.changeControlNo?.message
        }
      >
        <YesNo<MaintenanceQaValues>
          name="changeControlRequired"
          register={register}
        />
        {change === "yes" && (
          <input
            {...register("changeControlNo")}
            placeholder="Change control number"
            className={cn(CONTROL, "mt-2 font-mono")}
            aria-invalid={!!errors.changeControlNo}
          />
        )}
      </Field>

      <Field
        label="Deviation raised?"
        hint="If not already raised on this request."
        error={errors.deviationRaised?.message ?? errors.deviationNo?.message}
      >
        <YesNo<MaintenanceQaValues>
          name="deviationRaised"
          register={register}
        />
        {deviation === "yes" && (
          <input
            {...register("deviationNo")}
            placeholder="Deviation number"
            className={cn(CONTROL, "mt-2 font-mono")}
            aria-invalid={!!errors.deviationNo}
          />
        )}
      </Field>

      <Field label="Remarks" error={errors.qaRemarks?.message}>
        <textarea
          {...register("qaRemarks")}
          rows={3}
          placeholder="Anything QA wants on the record (optional)"
          className={AREA}
        />
      </Field>

      <Field
        label="QA sign"
        hint="Typed, and stamped with the time — the equivalent of the signature box."
        error={errors.qaSignName?.message}
      >
        <input
          {...register("qaSignName")}
          placeholder="Name"
          className={CONTROL}
          aria-invalid={!!errors.qaSignName}
        />
      </Field>

      <Submit pending={isSubmitting || verify.isPending}>
        Record QA review
      </Submit>
    </form>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

/**
 * The paper form's "(Delete one)" — as a pair of radios with no default, so
 * an unanswered question stays visibly unanswered instead of printing as a
 * confident "no".
 */
function YesNo<T extends FieldValues>({
  name,
  register,
}: {
  name: Path<T>;
  register: UseFormRegister<T>;
}) {
  return (
    <div className="flex gap-2">
      {(["yes", "no"] as const).map((value) => (
        <label
          key={value}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink-3 shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-deep has-[:checked]:shadow-none has-[:checked]:ring-2 has-[:checked]:ring-brand/15"
        >
          <input
            type="radio"
            value={value}
            {...register(name)}
            className="size-4 accent-brand"
          />
          {value === "yes" ? "Yes" : "No"}
        </label>
      ))}
    </div>
  );
}

function Intro({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-4">{body}</p>
    </div>
  );
}

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

function Submit({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-deep px-4 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
