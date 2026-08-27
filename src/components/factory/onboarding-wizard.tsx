"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { completeOnboarding } from "@/app/factory/[slug]/actions";
import {
  UNIT_PRESETS,
  onboardingSchema,
  type OnboardingValues,
} from "@/app/factory/[slug]/schemas";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-xl border border-line bg-sunken px-3.5 py-3 text-[15px] text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/12";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-ink-5";

/**
 * First-run setup for a factory, shown over its dashboard until
 * `onboarded_at` is set. Not dismissible — the tenant has to name its units
 * before the operational modules have a vocabulary to use.
 */
export function OnboardingWizard({
  factoryId,
  factoryName,
}: {
  factoryId: string;
  factoryName: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      factoryId,
      companyName: factoryName,
      unitPreset: "Room",
      customUnitLabel: "",
    },
  });

  async function onSubmit(values: OnboardingValues) {
    setError(null);
    const result = await completeOnboarding(values);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    toast.success("Setup complete — welcome to FactoryOS.");
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/60 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 w-full max-w-2xl overflow-hidden rounded-2xl bg-surface shadow-[0_30px_80px_-20px_rgba(20,22,43,0.5)]">
        {/* header */}
        <div className="bg-ink px-9 py-8 text-white">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-brand text-lg font-bold">
              F
            </div>
            <span className="text-lg font-bold tracking-tight">FactoryOS</span>
          </div>
          <h1 className="mt-6 text-[28px] font-bold leading-tight">
            Welcome to FactoryOS
          </h1>
          <p className="mt-1.5 text-sm text-placeholder">
            Production intelligence for shift teams. Set up in 30 seconds.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-6 px-9 py-8">
            {/* company / site name */}
            <div className="space-y-2">
              <label htmlFor="ob-company" className={LABEL}>
                Company / site name
              </label>
              <input
                id="ob-company"
                placeholder="e.g. AcelPharma, Riverside Nutraceuticals…"
                aria-invalid={Boolean(errors.companyName)}
                className={FIELD}
                {...register("companyName")}
              />
              {errors.companyName && (
                <p className="text-xs text-danger-deep">
                  {errors.companyName.message}
                </p>
              )}
            </div>

            {/* unit vocabulary */}
            <div className="space-y-2">
              <span className={LABEL}>
                What do you call your production units?
              </span>
              <Controller
                control={control}
                name="unitPreset"
                render={({ field }) => (
                  <>
                    <div
                      role="radiogroup"
                      aria-label="Production unit type"
                      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                    >
                      {UNIT_PRESETS.map((preset) => {
                        const selected = field.value === preset.value;
                        return (
                          <button
                            key={preset.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => field.onChange(preset.value)}
                            className={cn(
                              "rounded-xl border px-3 py-4 text-center transition",
                              selected
                                ? "border-brand bg-brand-soft"
                                : "border-line bg-surface hover:border-ink-6",
                            )}
                          >
                            <span className="text-xl">{preset.icon}</span>
                            <span className="mt-1.5 block text-sm font-semibold text-ink">
                              {preset.value === "Custom"
                                ? "Custom"
                                : preset.plural}
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-5">
                              {preset.hint}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {field.value === "Custom" && (
                      <div className="space-y-1.5 pt-3">
                        <input
                          aria-label="What you call one production unit"
                          placeholder="What do you call one of them? e.g. Cell, Bay, Vessel"
                          aria-invalid={Boolean(errors.customUnitLabel)}
                          className={FIELD}
                          {...register("customUnitLabel")}
                        />
                        {errors.customUnitLabel && (
                          <p className="text-xs text-danger-deep">
                            {errors.customUnitLabel.message}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              />

              {errors.unitPreset && (
                <p className="text-xs text-danger-deep">
                  {errors.unitPreset.message}
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-deep"
              >
                {error}
              </p>
            )}
          </div>

          {/* footer */}
          <div className="flex justify-end border-t border-line-soft px-9 py-5">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-7 py-3 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {isSubmitting ? "Setting up…" : "Get started"}
              {!isSubmitting && <ArrowRight className="size-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
