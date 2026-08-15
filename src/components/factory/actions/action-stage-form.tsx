"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Check, CornerUpLeft, Loader2, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  actionTakenSchema,
  closeSchema,
  investigateSchema,
  revertSchema,
  type ActionTakenValues,
  type CloseValues,
  type InvestigateValues,
  type RevertValues,
} from "@/app/factory/[slug]/actions/schemas";
import type { FactoryRole } from "@/lib/factory/context";
import {
  advanceAction,
  canReview,
  prevStage,
  relativeTime,
  revertAction,
  saveRootCause,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 py-2.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB]";

const PRIMARY =
  "inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-[1.06] disabled:opacity-60";

const GHOST =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6EAF1] bg-white px-3 text-xs font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:pointer-events-none disabled:opacity-40";

/**
 * The form for the **one** move this issue can make next — and nothing else.
 *
 * The rule you asked for lives here as much as in the trigger: while an issue
 * is Open there is no box to type a corrective action into, because the
 * corrective-action form is not rendered until the issue is Investigating.
 * The database refuses the write; this refuses the temptation. Between them,
 * "resolved" stops being something anyone can assert in one click.
 */
export function ActionStageForm({
  action,
  role,
  onDone,
}: {
  action: FactoryAction;
  role: FactoryRole;
  onDone: () => Promise<void> | void;
}) {
  const back = prevStage(action.status);

  return (
    <div className="space-y-3">
      {action.status === "open" && <StartForm action={action} onDone={onDone} />}
      {action.status === "investigating" && (
        <ActionTakenForm action={action} onDone={onDone} />
      )}
      {action.status === "action_taken" && (
        <ClosePanel action={action} role={role} onDone={onDone} />
      )}
      {action.status === "closed" && <ClosedPanel role={role} />}

      {back && <RevertPanel action={action} role={role} onDone={onDone} />}
    </div>
  );
}

/* ── open → investigating ─────────────────────────────────────────────── */

function StartForm({
  action,
  onDone,
}: {
  action: FactoryAction;
  onDone: () => Promise<void> | void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InvestigateValues>({
    resolver: zodResolver(investigateSchema),
    defaultValues: { assignedTo: action.assigned_to ?? "" },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await advanceAction(action.id, "investigating", {
        assignedTo: values.assignedTo,
      });
      await onDone();
      toast.success("Investigation started.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-[#F8FAFC] p-3.5">
      <Legend
        title="Start the investigation"
        hint="An issue nobody owns is everybody's, which is to say nobody's."
      />
      <Field label="Who is looking into this?" error={errors.assignedTo?.message}>
        <input
          {...register("assignedTo")}
          placeholder="Name — the person, not the department"
          className={FIELD}
          aria-invalid={!!errors.assignedTo}
        />
      </Field>
      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(PRIMARY, "bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)]")}
      >
        {isSubmitting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        Start investigating
      </button>
    </form>
  );
}

/* ── investigating → action_taken ─────────────────────────────────────── */

function ActionTakenForm({
  action,
  onDone,
}: {
  action: FactoryAction;
  onDone: () => Promise<void> | void;
}) {
  const {
    control,
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ActionTakenValues>({
    resolver: zodResolver(actionTakenSchema),
    defaultValues: {
      rootCause: action.root_cause ?? "",
      correctiveAction: "",
      preventiveAction: "",
    },
  });

  // Subscribed with `useWatch` rather than `watch()` so the draft button can
  // react to typing without handing React Compiler a function it can't
  // memoize — the callback below reads the value with `getValues` instead.
  const rootCause = useWatch({ control, name: "rootCause" });

  // An investigation is rarely one sitting. Saving the cause without moving
  // the issue on beats retyping it from a scrap of paper on Thursday.
  const draft = useMutation({
    mutationFn: () => saveRootCause(action.id, getValues("rootCause")),
    onSuccess: async () => {
      await onDone();
      toast.success("Root cause saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = handleSubmit(async (values) => {
    try {
      await advanceAction(action.id, "action_taken", {
        rootCause: values.rootCause,
        correctiveAction: values.correctiveAction,
        preventiveAction: values.preventiveAction,
      });
      await onDone();
      toast.success("Action recorded — waiting on sign-off.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  const busy = isSubmitting || draft.isPending;

  return (
    <form onSubmit={submit} className="space-y-2.5 rounded-xl bg-[#F8FAFC] p-3.5">
      <Legend
        title="Record the fix"
        hint="Both boxes are the record of how this problem was actually solved."
      />

      <Field label="Root cause" error={errors.rootCause?.message}>
        <textarea
          {...register("rootCause")}
          rows={2}
          placeholder="What actually caused it — not just what broke"
          className={FIELD}
          aria-invalid={!!errors.rootCause}
        />
      </Field>

      <Field label="Corrective action" error={errors.correctiveAction?.message}>
        <textarea
          {...register("correctiveAction")}
          rows={2}
          placeholder="What was done about it"
          className={FIELD}
          aria-invalid={!!errors.correctiveAction}
        />
      </Field>

      <Field
        label="Preventive action"
        optional
        error={errors.preventiveAction?.message}
      >
        <textarea
          {...register("preventiveAction")}
          rows={2}
          placeholder="What stops it happening again — leave blank if nothing generalises"
          className={FIELD}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className={cn(PRIMARY, "bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)]")}
        >
          {isSubmitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Log action taken
        </button>
        <button
          type="button"
          onClick={() => draft.mutate()}
          disabled={busy || !rootCause?.trim()}
          className={cn(GHOST, "h-10")}
        >
          {draft.isPending && <Loader2 className="size-3.5 animate-spin" />}
          Save cause for now
        </button>
      </div>
    </form>
  );
}

/* ── action_taken → closed ────────────────────────────────────────────── */

function ClosePanel({
  action,
  role,
  onDone,
}: {
  action: FactoryAction;
  role: FactoryRole;
  onDone: () => Promise<void> | void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CloseValues>({
    resolver: zodResolver(closeSchema),
    defaultValues: { verification: "" },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await advanceAction(action.id, "closed", {
        verification: values.verification,
      });
      await onDone();
      toast.success("Issue closed.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  // The fix is in; what is left is a signature. Anyone can see that state —
  // only a supervisor and up gets the form for it.
  if (!canReview(role)) {
    return (
      <p className="rounded-xl border border-[#E6EAF1] bg-[#F8FAFC] px-3.5 py-3 text-[13px] text-[#475569]">
        The fix is recorded. A supervisor or above signs it off
        {action.verify_due_at && (
          <>
            {" — due "}
            <span
              className={cn(
                "font-semibold",
                action.is_verify_overdue ? "text-[#B45309]" : "text-[#0F1B34]"
              )}
            >
              {relativeTime(action.verify_due_at)}
            </span>
          </>
        )}
        .
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-[#F0FDF4] p-3.5">
      <Legend
        title="Verify and close"
        hint="Closing is a review — say how you know the fix held."
      />
      <Field label="Verification" error={errors.verification?.message}>
        <textarea
          {...register("verification")}
          rows={2}
          placeholder="Retested at 14:00, three batches clean — how you know it worked"
          className={FIELD}
          aria-invalid={!!errors.verification}
        />
      </Field>
      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(PRIMARY, "bg-[#16A34A]")}
      >
        {isSubmitting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="size-3.5" />
        )}
        Verify &amp; close
      </button>
    </form>
  );
}

function ClosedPanel({ role }: { role: FactoryRole }) {
  return (
    <p className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-3.5 py-3 text-[13px] text-[#15803D]">
      Closed and signed off.
      {canReview(role)
        ? " Re-open it below if it comes back."
        : " A supervisor can re-open it if it comes back."}
    </p>
  );
}

/* ── Going back ───────────────────────────────────────────────────────── */

/**
 * The only way backwards, and it costs a written reason.
 *
 * Not a nicety: `revert_action()` takes the reason as an argument, so a
 * revert without one is not something the API can express. This form is the
 * front of that, collapsed until asked for — undoing someone else's work
 * should take a decision, not a stray click.
 */
function RevertPanel({
  action,
  role,
  onDone,
}: {
  action: FactoryAction;
  role: FactoryRole;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const to = prevStage(action.status);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RevertValues>({
    resolver: zodResolver(revertSchema),
    defaultValues: { reason: "" },
  });

  if (!to) return null;

  // Re-opening undoes a sign-off, so it takes the standing that signing off
  // took. Sending a failed fix back to investigation does not — the person who
  // finds out it didn't work is usually the one running the line.
  const blocked = action.status === "closed" && !canReview(role);
  if (blocked) return null;

  const label =
    action.status === "closed" ? "Re-open" : "Send back to investigating";

  const submit = handleSubmit(async (values) => {
    try {
      await revertAction(action.id, to, values.reason);
      reset();
      setOpen(false);
      await onDone();
      toast.success(
        action.status === "closed" ? "Re-opened." : "Sent back to investigating."
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={GHOST}>
        <CornerUpLeft className="size-3.5" />
        {label}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5"
    >
      <Legend
        title={label}
        hint={
          action.status === "closed"
            ? "The recorded cause and fix are cleared — they're kept in the thread."
            : "The corrective action is cleared and kept in the thread."
        }
      />
      <Field label="Why?" error={errors.reason?.message}>
        <textarea
          {...register("reason")}
          rows={2}
          placeholder="What went wrong with the fix"
          className={FIELD}
          aria-invalid={!!errors.reason}
        />
      </Field>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(PRIMARY, "h-9 bg-[#B45309] text-xs")}
        >
          {isSubmitting && <Loader2 className="size-3.5 animate-spin" />}
          {label}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={isSubmitting}
          className={GHOST}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Small shared bits ────────────────────────────────────────────────── */

function Legend({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]">
        {title}
      </p>
      <p className="mt-0.5 text-[11.5px] text-[#64748B]">{hint}</p>
    </div>
  );
}

function Field({
  label,
  optional,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      {/* The control sits inside the label, so it is associated with it
          without every caller having to invent a matching id. */}
      <label className="block space-y-1 text-xs font-medium text-[#475569]">
        <span className="block">
          {label}
          {optional && (
            <span className="ml-1 font-normal text-[#94A3B8]">(optional)</span>
          )}
        </span>
        {children}
      </label>
      {error && <p className="text-[11.5px] text-[#DC2626]">{error}</p>}
    </div>
  );
}
