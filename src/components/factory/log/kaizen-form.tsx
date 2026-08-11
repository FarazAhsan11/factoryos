"use client";

import { useForm, useWatch } from "react-hook-form";
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
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/12";
const LABEL =
  "block text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]";

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
      className="rounded-2xl border border-[#E6EAF1] bg-white"
    >
      <header className="border-b border-[#EEF1F6] px-5 py-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#0F1B34]">
          <span className="grid size-7 place-items-center rounded-lg bg-[#FEF9C3]">
            <Lightbulb className="size-4 text-[#CA8A04]" />
          </span>
          Kaizen — continuous improvement
        </h2>
        <p className="mt-1 text-[13px] text-[#64748B]">
          Spotted something that would make the job easier, safer or faster?
          Say it here — a supervisor reviews every one.
        </p>
      </header>

      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <label htmlFor="k-idea" className={LABEL}>
            What&rsquo;s your idea?{" "}
            <span className="font-medium normal-case tracking-normal text-[#64748B]">
              Be specific — what problem does it solve?
            </span>
          </label>
          <textarea
            id="k-idea"
            rows={4}
            placeholder="e.g. If we move the tablet press closer to the coating pan, we'd save about 15 minutes of transfer time per batch…"
            aria-invalid={Boolean(errors.idea)}
            className={cn(
              "w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 py-3 text-sm leading-relaxed text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/12",
              errors.idea && "border-[#FCA5A5]"
            )}
            {...register("idea")}
          />
          <div className="flex items-start justify-between gap-3">
            <p
              role={errors.idea ? "alert" : undefined}
              className={cn(
                "text-[11px]",
                errors.idea ? "text-[#B91C1C]" : "text-[#94A3B8]"
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
                  remaining < 0 ? "text-[#B91C1C]" : "text-[#94A3B8]"
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
            <select id="k-category" className={FIELD} {...register("category")}>
              {KAIZEN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="k-impact" className={LABEL}>
              Expected effort
            </label>
            <select id="k-impact" className={FIELD} {...register("impact")}>
              {KAIZEN_IMPACTS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Where the prototype's "Submitted by" text box was. Shown, not
            asked: the name is already known, and a field you can leave blank
            makes the attribution optional — which is exactly the part that
            makes anyone submit a second idea. */}
        <div className="flex items-center gap-2.5 rounded-xl bg-[#F8FAFC] px-3.5 py-2.5">
          <UserRound className="size-4 shrink-0 text-[#94A3B8]" />
          <p className="text-[13px] text-[#475569]">
            Submitted as{" "}
            <strong className="font-semibold text-[#0F1B34]">{userName}</strong>
            <span className="ml-1 text-[#94A3B8]">
              — your name goes on it, so you get the credit.
            </span>
          </p>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] text-sm font-semibold text-white shadow-[0_10px_24px_-8px_rgba(37,99,235,0.6)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Lightbulb className="size-4" />
          )}
          Submit idea
        </button>
      </div>
    </form>
  );
}
