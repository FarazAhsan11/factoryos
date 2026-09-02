"use client";

import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";

import {
  kaizenIdeaSchema,
  type KaizenIdeaValues,
} from "@/app/factory/[slug]/log/schemas";
import {
  KAIZEN_CATEGORIES,
  KAIZEN_IMPACTS,
  kaizenKeys,
  submitKaizenIdea,
} from "@/lib/factory/kaizen-queries";
import { SelectField } from "@/components/ui/select-field";
import { cn } from "@/lib/utils";

const LABEL =
  "block text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2";

const EMPTY: KaizenIdeaValues = {
  idea: "",
  category: "Process",
  impact: "quick_win",
};

/**
 * Submit an improvement idea.
 *
 * Three fields, and that is a limit rather than a starting point. This form
 * competes with going back to the line: every extra question is a reason to
 * close the tab, and an idea that was never submitted is worth less than one
 * submitted without a category. The prototype's fourth field — the operator's
 * own name — is gone entirely; the session already knows it, so it is shown
 * back as a fact rather than asked for as a question.
 */
export function KaizenForm({
  factoryId,
  userId,
  userName,
}: {
  factoryId: string;
  userId: string;
  /** The signed-in person, shown in place of the prototype's name box. */
  userName: string;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<KaizenIdeaValues>({
    resolver: zodResolver(kaizenIdeaSchema),
    defaultValues: EMPTY,
  });

  const submit = useMutation({
    mutationFn: (values: KaizenIdeaValues) =>
      submitKaizenIdea(factoryId, userId, values),
    onSuccess: async () => {
      reset(EMPTY);
      await queryClient.invalidateQueries({
        queryKey: kaizenKeys.all(factoryId),
      });
      toast.success("Idea submitted — it's in the review queue.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // `useWatch`, not `watch()` — the latter returns a fresh function each
  // render, which the React Compiler refuses to memoize around.
  const idea = useWatch({ control, name: "idea" }) ?? "";
  const remaining = 1000 - idea.length;

  return (
    <form
      onSubmit={handleSubmit((values) => submit.mutateAsync(values))}
      className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:h-full"
    >
      <header className="shrink-0 border-b border-line-soft bg-gradient-to-b from-warn-tint to-surface px-5 py-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="grid size-7 place-items-center rounded-lg bg-warn-soft">
            <Lightbulb className="size-4 text-warn-deep" />
          </span>
          Kaizen — continuous improvement
        </h2>
        <p className="mt-1 text-[13px] text-ink-4">
          Spotted something that would make the job easier, safer or faster? Say
          it here — a supervisor reviews every one.
        </p>
      </header>

      <div className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="space-y-1.5">
          <label htmlFor="k-idea" className={LABEL}>
            What&rsquo;s your idea?{" "}
            <span className="font-medium normal-case tracking-normal text-ink-4">
              Be specific — what problem does it solve?
            </span>
          </label>
          <textarea
            id="k-idea"
            rows={4}
            placeholder="e.g. If we move the tablet press closer to the coating pan, we'd save about 15 minutes of transfer time per batch…"
            aria-invalid={Boolean(errors.idea)}
            className={cn(
              "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-sm leading-relaxed text-ink shadow-[0_1px_2px_rgba(20,22,43,0.04)] outline-none transition placeholder:text-placeholder hover:border-ink-6 focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12",
              errors.idea && "border-danger-line",
            )}
            {...register("idea")}
          />
          <div className="flex items-start justify-between gap-3">
            <p
              role={errors.idea ? "alert" : undefined}
              className={cn(
                "text-[11px]",
                errors.idea ? "text-danger-deep" : "text-ink-5",
              )}
            >
              {errors.idea?.message ??
                "The more concrete, the easier it is to action."}
            </p>
            {/* Only once it's close enough to matter — a counter sitting at
                1000 from the first keystroke is a threat, not a help. */}
            {remaining < 200 && (
              <span
                className={cn(
                  "shrink-0 font-mono text-[11px]",
                  remaining < 0 ? "text-danger-deep" : "text-ink-5",
                )}
              >
                {remaining}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="k-category" className={LABEL}>
              Category
            </label>
            <Controller
              name="category"
              control={control}
              render={({ field }) => (
                <SelectField
                  id="k-category"
                  className="h-11"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  options={KAIZEN_CATEGORIES.map((c) => ({
                    value: c,
                    label: c,
                  }))}
                />
              )}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="k-impact" className={LABEL}>
              Expected effort
            </label>
            <Controller
              name="impact"
              control={control}
              render={({ field }) => (
                <SelectField
                  id="k-impact"
                  className="h-11"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  options={KAIZEN_IMPACTS.map((i) => ({
                    value: i.value,
                    label: i.label,
                  }))}
                />
              )}
            />
          </div>
        </div>

        {/* Where the prototype's "Submitted by" text box was. Shown, not
            asked: the name is already known, and a field you can leave blank
            makes the attribution optional — which is exactly the part that
            makes anyone submit a second idea. */}
        <div className="flex items-center gap-2.5 rounded-xl border border-line-soft bg-sunken px-3.5 py-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-ink-4 ring-1 ring-line">
            <UserRound className="size-4" />
          </span>
          <p className="text-[13px] text-ink-3">
            Submitted as{" "}
            <strong className="font-semibold text-ink">{userName}</strong>
            <span className="ml-1 text-ink-5">
              — your name goes on it, so you get the credit.
            </span>
          </p>
        </div>
      </div>

      <footer className="shrink-0 border-t border-line-soft bg-gradient-to-b from-surface to-sunken p-4 sm:px-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.995] disabled:pointer-events-none disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Lightbulb className="size-4" />
          )}
          Submit idea
        </button>
      </footer>
    </form>
  );
}
