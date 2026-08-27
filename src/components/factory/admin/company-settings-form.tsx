"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateCompanySettings } from "@/app/factory/[slug]/admin/actions";
import {
  companySettingsSchema,
  type CompanySettingsValues,
} from "@/app/factory/[slug]/admin/schemas";
import type { FactoryContext } from "@/lib/factory/context";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:ring-4 focus:ring-brand/12 disabled:bg-sunken disabled:text-ink-5";
const LABEL = "text-xs font-medium text-ink-3";

export function CompanySettingsForm({
  factory,
  canManage,
}: {
  factory: FactoryContext["factory"];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<CompanySettingsValues>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: {
      factoryId: factory.id,
      name: factory.name,
      description: factory.description ?? "",
      unitLabel: factory.unit_label ?? "Unit",
      unitLabelPlural: factory.unit_label_plural ?? "Units",
      oeeTarget: factory.oee_target,
      escalateHours: factory.escalate_hours,
    },
  });

  const save = useMutation({
    mutationFn: async (values: CompanySettingsValues) => {
      const result = await updateCompanySettings(values);
      if ("error" in result) throw new Error(result.error);
      return values;
    },
    onSuccess: (values) => {
      setError(null);
      // Re-baseline the form so isDirty resets without losing what was typed.
      reset(values);
      toast.success("Company settings saved.");
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => {
        setError(null);
        save.mutate(values);
      })}
      className="max-w-xl space-y-5 rounded-2xl border border-line bg-surface p-6"
    >
      <input type="hidden" {...register("factoryId")} />

      <Field label="Company / site name" error={errors.name?.message}>
        <input
          disabled={!canManage}
          aria-invalid={Boolean(errors.name)}
          className={FIELD}
          {...register("name")}
        />
      </Field>

      <Field label="Short info" error={errors.description?.message} optional>
        <textarea
          rows={2}
          disabled={!canManage}
          placeholder="What this factory makes, where it is…"
          className={`${FIELD} h-auto resize-none py-2.5`}
          {...register("description")}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Production unit (singular)"
          error={errors.unitLabel?.message}
        >
          <input
            disabled={!canManage}
            placeholder="Room"
            aria-invalid={Boolean(errors.unitLabel)}
            className={FIELD}
            {...register("unitLabel")}
          />
        </Field>
        <Field
          label="Production units (plural)"
          error={errors.unitLabelPlural?.message}
        >
          <input
            disabled={!canManage}
            placeholder="Rooms"
            aria-invalid={Boolean(errors.unitLabelPlural)}
            className={FIELD}
            {...register("unitLabelPlural")}
          />
        </Field>

        <Field label="OEE target (%)" error={errors.oeeTarget?.message}>
          <input
            type="number"
            min={50}
            max={100}
            disabled={!canManage}
            aria-invalid={Boolean(errors.oeeTarget)}
            className={FIELD}
            {...register("oeeTarget", { valueAsNumber: true })}
          />
        </Field>
        <Field
          label="Escalate actions after (hours overdue)"
          error={errors.escalateHours?.message}
        >
          <input
            type="number"
            min={1}
            max={48}
            disabled={!canManage}
            aria-invalid={Boolean(errors.escalateHours)}
            className={FIELD}
            {...register("escalateHours", { valueAsNumber: true })}
          />
        </Field>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-deep"
        >
          {error}
        </p>
      )}

      {canManage && (
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={save.isPending || !isDirty}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
          {isDirty && !save.isPending && (
            <span className="text-xs text-ink-5">Unsaved changes</span>
          )}
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  error,
  optional,
  children,
}: {
  label: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className={LABEL}>
        {label}
        {optional && <span className="text-ink-5"> (optional)</span>}
      </span>
      {children}
      {error && <p className="text-xs text-danger-deep">{error}</p>}
    </div>
  );
}
