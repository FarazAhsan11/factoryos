"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { addEmployee } from "@/app/factory/[slug]/admin/employee-actions";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  addEmployeeSchema,
  type AddEmployeeValues,
} from "@/app/factory/[slug]/admin/schemas";

const FIELD =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/12";
const LABEL = "text-xs font-medium text-[#475569]";

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
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddEmployeeValues>({
    resolver: zodResolver(addEmployeeSchema),
    defaultValues: { factoryId, fullName: "", email: "", role: "operator" },
  });

  async function onSubmit(values: AddEmployeeValues) {
    const result = await addEmployee(values);

    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if (result.warning) toast.warning(result.warning);
    else toast.success(`Invite sent to ${values.email}.`);

    reset({ factoryId, fullName: "", email: "", role: "operator" });
    onAdded();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-2xl border border-[#E6EAF1] bg-[#FBFCFE] p-4"
    >
      <p className="mb-3 text-[13px] font-semibold text-[#0F1B34]">
        Add someone to this factory
      </p>

      <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_150px_auto] sm:items-end">
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
          <select id="emp-role" className={FIELD} {...register("role")}>
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserPlus className="size-4" />
          )}
          {isSubmitting ? "Inviting…" : "Add & invite"}
        </button>
      </div>

      {(errors.fullName || errors.email || errors.role) && (
        <p role="alert" className="mt-2.5 text-xs text-[#B91C1C]">
          {errors.fullName?.message ??
            errors.email?.message ??
            errors.role?.message}
        </p>
      )}

      <p className="mt-2.5 text-xs text-[#94A3B8]">
        They&rsquo;ll get an email inviting them to set a password and open this
        factory&rsquo;s dashboard.
      </p>
    </form>
  );
}
