"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import {
  Check,
  CheckCheck,
  CornerUpLeft,
  Loader2,
  Play,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import {
  closeSchema,
  correctiveActionSchema,
  investigateSchema,
  resolveDirectSchema,
  revertSchema,
  rootCauseSchema,
  type CloseValues,
  type CorrectiveActionValues,
  type InvestigateValues,
  type ResolveDirectValues,
  type RevertValues,
  type RootCauseValues,
} from "@/app/factory/[slug]/actions/schemas";
import type { FactoryRole } from "@/lib/factory/context";
import {
  REVERT_LABELS,
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
  "inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-[1.06] disabled:opacity-60";

/** Full width, centred — how a card's committing button should read. */
const BLOCK = "w-full justify-center";

const GHOST =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6EAF1] bg-white px-3 text-xs font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:pointer-events-none disabled:opacity-40";

/**
 * The form for the move this issue can make next — and nothing else.
 *
 * Each card asks for the thing its own stage is named after, which is the
 * whole of what migration 0027 changed. Investigating asks for a cause and
 * stops there; Action taken is where "what did you do about it" is finally a
 * fair question, because by then the answer to "what caused it" is on screen
 * above it; Verification asks how you know it held.
 *
 * The rule lives here as much as in the trigger: while an issue is Open there
 * is no box to type a corrective action into, because that form is not
 * rendered until the issue has a recorded root cause. The database refuses the
 * write; this refuses the temptation. Between them, a recorded fix stops being
 * something anyone can assert in one click.
 *
 * Open is the one stage with two doors, because not every issue has a root
 * cause worth an hour. See `OpenPanel`.
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
      {action.status === "open" && (
        <OpenPanel action={action} role={role} onDone={onDone} />
      )}
      {action.status === "investigating" && (
        <RootCauseForm action={action} onDone={onDone} />
      )}
      {action.status === "action_taken" && (
        <CorrectiveActionForm action={action} onDone={onDone} />
      )}
      {action.status === "verification" && (
        <ClosePanel action={action} role={role} onDone={onDone} />
      )}
      {action.status === "closed" && (
        <ClosedPanel action={action} role={role} />
      )}

      {back && <RevertPanel action={action} role={role} onDone={onDone} />}
    </div>
  );
}

/* ── The two doors out of Open ────────────────────────────────── */

/**
 * An open issue is the only one with a choice about how it leaves.
 *
 * Most go the long way: an owner, a root cause, a recorded fix, a sign-off.
 * But a guard left off a conveyor or a bin in the wrong bay has no root cause
 * worth writing down, and putting those through four gates does not produce a
 * better record — it produces four boxes of "n/a", and a floor that quietly
 * stops raising the small stuff, which is exactly the stuff that is cheap to
 * fix early.
 *
 * Both doors are on screen, in one card, separated by a rule. Hiding the short
 * one behind a link made it look like an escape hatch; giving it equal billing
 * would make skipping the CAPA read as an equal default. So: same card, same
 * width, one solid button and one outlined. The choice is obvious, and so is
 * which of the two is the ordinary route.
 *
 * Deciding an issue needs no CAPA *is* the review, so for anyone below
 * supervisor the second door simply is not there.
 */
function OpenPanel({
  action,
  role,
  onDone,
}: {
  action: FactoryAction;
  role: FactoryRole;
  onDone: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-[#E6EAF1] bg-white p-4">
      <StartForm action={action} onDone={onDone} />
      {canReview(role) && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-[#EEF1F6]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-[#CBD5E1]">
              or
            </span>
            <span className="h-px flex-1 bg-[#EEF1F6]" />
          </div>
          <ResolveDirectPanel action={action} onDone={onDone} />
        </>
      )}
    </div>
  );
}

/* ── open → investigating ─────────────────────────────────────── */

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
    <form onSubmit={submit} className="space-y-3">
      <Legend
        title="Start the investigation"
        hint="An issue nobody owns is everybody&rsquo;s, which is to say nobody&rsquo;s."
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
        className={cn(
          PRIMARY,
          BLOCK,
          "bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] shadow-[0_8px_20px_-8px_rgba(37,99,235,0.6)]"
        )}
      >
        {isSubmitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        Start investigating
      </button>
    </form>
  );
}

/* ── open → closed, the short road ────────────────────────────── */

/**
 * Resolve an issue outright, skipping the CAPA cycle.
 *
 * The button is always there; the box it costs opens on the click. That order
 * matters — an empty textarea sitting under "or" would advertise the short
 * road as the quicker option before anyone has decided anything. And it is
 * not free: it costs an account of what was actually done, held to the same
 * eight characters every other recorded field is, because "fixed" tells the
 * next person nothing.
 *
 * The text goes into `verification`, the column a close already fills at this
 * boundary. Nothing was verified here, though — there was no corrective
 * action to verify — so the record reads it back as a *resolution*, keyed off
 * `resolved_direct`. One column, two honest labels.
 */
function ResolveDirectPanel({
  action,
  onDone,
}: {
  action: FactoryAction;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResolveDirectValues>({
    resolver: zodResolver(resolveDirectSchema),
    defaultValues: { verification: "" },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await advanceAction(action.id, "closed", {
        verification: values.verification,
      });
      reset();
      setOpen(false);
      await onDone();
      toast.success("Resolved — no investigation needed.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-[#64748B]">
          Dealt with already, and no root cause worth chasing?
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            BLOCK,
            "inline-flex h-11 items-center gap-2 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] text-sm font-semibold text-[#15803D] transition hover:border-[#16A34A] hover:bg-[#DCFCE7]"
          )}
        >
          <CheckCheck className="size-4" />
          Resolve it outright
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Legend
        title="Resolve without a full CAPA"
        hint="It closes here — the account below is the whole record of it."
      />
      <Field label="What was done about it?" error={errors.verification?.message}>
        <textarea
          {...register("verification")}
          rows={3}
          autoFocus
          placeholder="Guard refitted and checked on the spot — enough that the next person knows what happened"
          className={FIELD}
          aria-invalid={!!errors.verification}
        />
      </Field>
      {/* Said before the click, not discovered after it: this is a shortcut
          through the record, not around it. */}
      <p className="text-[11px] text-[#64748B]">
        Recorded as resolved without an investigation, under your name. If it
        comes back, re-open it and it takes the full route.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            PRIMARY,
            "flex-1 justify-center bg-[#16A34A] shadow-[0_8px_20px_-8px_rgba(22,163,74,0.6)]"
          )}
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCheck className="size-4" />
          )}
          Resolve
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={isSubmitting}
          className={cn(GHOST, "h-11")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── investigating → action_taken ─────────────────────────────────────── */

/**
 * The investigation's one output, and nothing else on the card.
 *
 * This used to ask for the corrective and preventive actions too, because
 * filling all three was the price of the next stage. On screen that read as
 * the stepper saying INVESTIGATING in blue over a box asking what had been
 * done about a cause the person had not finished typing. One question at a
 * time is not a smaller form — it is the difference between a root cause
 * someone thought about and one they wrote to unlock the box below it.
 */
function RootCauseForm({
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
  } = useForm<RootCauseValues>({
    resolver: zodResolver(rootCauseSchema),
    defaultValues: { rootCause: action.root_cause ?? "" },
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
      });
      await onDone();
      toast.success("Root cause recorded — now the fix.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  const busy = isSubmitting || draft.isPending;

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl border border-[#E6EAF1] bg-white p-4"
    >
      <Legend
        title="What caused it"
        hint="One question. What was done about it comes next, once this is on the record."
      />

      <Field label="Root cause" error={errors.rootCause?.message}>
        <textarea
          {...register("rootCause")}
          rows={3}
          placeholder="What actually caused it — not just what broke"
          className={FIELD}
          aria-invalid={!!errors.rootCause}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className={cn(
            PRIMARY,
            "flex-1 justify-center bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] shadow-[0_8px_20px_-8px_rgba(37,99,235,0.6)]"
          )}
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Record the cause
        </button>
        <button
          type="button"
          onClick={() => draft.mutate()}
          disabled={busy || !rootCause?.trim()}
          className={cn(GHOST, "h-11")}
        >
          {draft.isPending && <Loader2 className="size-3.5 animate-spin" />}
          Save for now
        </button>
      </div>
    </form>
  );
}

/* ── action_taken → verification ──────────────────────────────────────── */

/**
 * The C and the P of CAPA, asked at the stage that bears their name.
 *
 * The root cause is deliberately *not* repeated here. It is already on the
 * record — under Investigating in the timeline, where the stage that produced
 * it put it — and echoing it into the working card turns a form asking one
 * question back into a wall of text.
 */
function CorrectiveActionForm({
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
  } = useForm<CorrectiveActionValues>({
    resolver: zodResolver(correctiveActionSchema),
    defaultValues: {
      correctiveAction: action.corrective_action ?? "",
      preventiveAction: action.preventive_action ?? "",
    },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await advanceAction(action.id, "verification", {
        correctiveAction: values.correctiveAction,
        preventiveAction: values.preventiveAction,
      });
      await onDone();
      toast.success("Action recorded — waiting on sign-off.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl border border-[#E6EAF1] bg-white p-4"
    >
      <Legend
        title="Record the fix"
        hint="What was actually done about it — and what stops it recurring."
      />

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

      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(
          PRIMARY,
          BLOCK,
          "bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] shadow-[0_8px_20px_-8px_rgba(37,99,235,0.6)]"
        )}
      >
        {isSubmitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Wrench className="size-4" />
        )}
        Log action taken
      </button>
    </form>
  );
}

/* ── verification → closed ────────────────────────────────────────────── */

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
      <p className="rounded-2xl border border-[#E6EAF1] bg-white p-4 text-[13px] text-[#475569]">
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
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4"
    >
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
        className={cn(
          PRIMARY,
          BLOCK,
          "bg-[#16A34A] shadow-[0_8px_20px_-8px_rgba(22,163,74,0.6)]"
        )}
      >
        {isSubmitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ShieldCheck className="size-4" />
        )}
        Verify &amp; close
      </button>
    </form>
  );
}

function ClosedPanel({
  action,
  role,
}: {
  action: FactoryAction;
  role: FactoryRole;
}) {
  return (
    <p className="rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4 text-[13px] text-[#15803D]">
      {/* Two different things ended here, and saying which is the whole point
          of having recorded it: one issue was investigated and its fix
          verified, the other was small enough not to need either. */}
      {action.resolved_direct
        ? "Resolved directly — this one didn't need a CAPA."
        : "Closed and signed off."}
      {canReview(role)
        ? " Re-open it below if it comes back."
        : " A supervisor can re-open it if it comes back."}
    </p>
  );
}

/* ── Going back ───────────────────────────────────────────────────────── */

/** The same three moves as `REVERT_LABELS`, said in the past tense. */
const REVERT_DONE: Record<string, string> = {
  verification: "Fix sent back.",
  action_taken: "Sent back to investigating.",
  closed: "Re-opened.",
};

/** What each backward move clears, said before it is pressed rather than
    discovered afterwards. */
const REVERT_HINTS: Record<string, string> = {
  verification:
    "The corrective action is cleared — it's kept in the thread — and the issue goes back for another fix.",
  action_taken:
    "The recorded root cause is cleared — it's kept in the thread — and the investigation re-opens.",
};

/**
 * Three moves backwards, three different things that went wrong.
 *
 * A fix sent back failed a test; a cause sent back was the wrong cause; a
 * closed issue re-opened came back. Asking all three "what went wrong with the
 * fix" is how a required reason becomes a box people type "wrong" into.
 */
const REVERT_PLACEHOLDERS: Record<string, string> = {
  verification: "What went wrong with the fix",
  action_taken: "Why this isn't the real cause",
  closed: "What brought it back",
};

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

  const label = REVERT_LABELS[action.status] ?? "Send back";

  const submit = handleSubmit(async (values) => {
    try {
      await revertAction(action.id, to, values.reason);
      reset();
      setOpen(false);
      await onDone();
      toast.success(REVERT_DONE[action.status] ?? "Sent back.");
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
      className="space-y-3 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4"
    >
      <Legend
        title={label}
        hint={
          REVERT_HINTS[action.status] ??
          (action.resolved_direct
            ? "The recorded resolution is cleared — it's kept in the thread — and the issue goes back to Open with the full route available."
            : "The recorded cause and fix are cleared — they're kept in the thread.")
        }
      />
      <Field label="Why?" error={errors.reason?.message}>
        <textarea
          {...register("reason")}
          rows={2}
          placeholder={
            REVERT_PLACEHOLDERS[action.status] ?? "Why this is going back"
          }
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
