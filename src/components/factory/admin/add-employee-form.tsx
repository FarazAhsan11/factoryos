"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { addEmployee } from "@/app/factory/[slug]/admin/employee-actions";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  SHIFT_LABELS,
  SHIFT_SLOTS,
  addEmployeeSchema,
  type AddEmployeeValues,
} from "@/app/factory/[slug]/admin/schemas";

import { FIELD } from "@/components/factory/admin/settings-ui";
import { SelectField } from "@/components/ui/select-field";
const LABEL = "text-xs font-medium text-ink-3";

/**
 * Adds one person and emails their invite. Single adds always send — it's the
 * bulk import that stays silent — so the copy says so plainly.
 */
export function AddEmployeeForm({
  factoryId,
  onAdded,
}: {
  factoryId: string;
  onAdded: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddEmployeeValues>({
    resolver: zodResolver(addEmployeeSchema),
    defaultValues: {
      factoryId,
      fullName: "",
      email: "",
      role: "operator",
      defaultShift: "morning",
    },
  });

  async function onSubmit(values: AddEmployeeValues) {
    const result = await addEmployee(values);

    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if (result.warning) toast.warning(result.warning);
    else toast.success(`Invite sent to ${values.email}.`);

    reset({
      factoryId,
      fullName: "",
      email: "",
      role: "operator",
      defaultShift: values.defaultShift,
    });
    onAdded();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-2xl border border-line bg-sunken p-4 shadow-[inset_0_1px_2px_rgb(20_22_43/0.04)]"
    >
      <p className="mb-3 text-[11px] font-bold tracking-[0.07em] text-ink-4 uppercase">
        Add someone to this factory
      </p>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_130px_140px_auto] lg:items-end">
        <div className="space-y-1.5">
          <label htmlFor="emp-name" className={LABEL}>
            Full name
          </label>
          <input
            id="emp-name"
            placeholder="e.g. Thian Mang"
            aria-invalid={Boolean(errors.fullName)}
            className={FIELD}
            {...register("fullName")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="emp-email" className={LABEL}>
            Email
          </label>
          <input
            id="emp-email"
            type="email"
            autoComplete="off"
            placeholder="name@company.com"
            aria-invalid={Boolean(errors.email)}
            className={FIELD}
            {...register("email")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="emp-role" className={LABEL}>
            Role
          </label>
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <SelectField
                id="emp-role"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                options={ASSIGNABLE_ROLES.map((role) => ({
                  value: role,
                  label: ROLE_LABELS[role],
                }))}
              />
            )}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="emp-shift" className={LABEL}>
            Default shift
          </label>
          <Controller
            name="defaultShift"
            control={control}
            render={({ field }) => (
              <SelectField
                id="emp-shift"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                options={SHIFT_SLOTS.map((shift) => ({
                  value: shift,
                  label: SHIFT_LABELS[shift],
                }))}
              />
            )}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserPlus className="size-4" />
          )}
          {isSubmitting ? "Inviting…" : "Add & invite"}
        </button>
      </div>

      {(errors.fullName ||
        errors.email ||
        errors.role ||
        errors.defaultShift) && (
        <p role="alert" className="mt-2.5 text-xs text-danger-deep">
          {errors.fullName?.message ??
            errors.email?.message ??
            errors.role?.message ??
            errors.defaultShift?.message}
        </p>
      )}

      <p className="mt-2.5 text-xs text-ink-5">
        They&rsquo;ll get an email inviting them to set a password and open this
        factory&rsquo;s dashboard.
      </p>
    </form>
  );
}
