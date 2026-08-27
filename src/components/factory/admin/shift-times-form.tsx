"use client";

import { useEffect, useState } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Moon, Sun } from "lucide-react";
import { toast } from "sonner";

import { updateShiftTimes } from "@/app/factory/[slug]/admin/actions";
import {
  shiftTimesSchema,
  type ShiftClockValues,
  type ShiftTimesValues,
} from "@/app/factory/[slug]/admin/schemas";
import {
  DEFAULT_SHIFT_TIMES,
  breakIsInsideShift,
  fetchShiftTimes,
  formatDuration,
  productiveMinutes,
  shiftLengthMinutes,
  shiftTimeKeys,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import { TimeField } from "@/components/ui/date-picker";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:ring-4 focus:ring-brand/12 disabled:bg-sunken disabled:text-ink-5";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-ink-5";

/**
 * Admin → Shift times. Both shifts are edited together and saved in one go,
 * because the shift log reads them as a pair and a half-saved clock would give
 * the wrong shift duration.
 */
export function ShiftTimesForm({
  factoryId,
  canManage,
}: {
  factoryId: string;
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const {
    data,
    isPending,
    isError,
    error: loadError,
  } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm<ShiftTimesValues>({
    resolver: zodResolver(shiftTimesSchema),
    defaultValues: {
      factoryId,
      morning: DEFAULT_SHIFT_TIMES.morning,
      afternoon: DEFAULT_SHIFT_TIMES.afternoon,
    },
  });

  // The query resolves after first paint, so re-baseline once it lands —
  // otherwise the saved clock would never reach the inputs.
  useEffect(() => {
    if (data) reset({ factoryId, ...data });
  }, [data, factoryId, reset]);

  const save = useMutation({
    mutationFn: async (values: ShiftTimesValues) => {
      const result = await updateShiftTimes(values);
      if ("error" in result) throw new Error(result.error);
      return values;
    },
    onSuccess: (values) => {
      setError(null);
      reset(values);
      toast.success(
        `Shift times saved — morning ${values.morning.startTime}–${values.morning.endTime}.`,
      );
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isPending) return <FormSkeleton />;
  if (isError) {
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
        Could not load shift times: {(loadError as Error).message}
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit((values) => {
        setError(null);
        save.mutate(values);
      })}
      className="space-y-5"
    >
      <input type="hidden" {...register("factoryId")} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ShiftCard
          slot="morning"
          title="Morning shift"
          icon={<Sun className="size-4 text-warn" />}
          register={register}
          control={control}
          errors={errors.morning}
          disabled={!canManage}
        />
        <ShiftCard
          slot="afternoon"
          title="Afternoon shift"
          icon={<Moon className="size-4 text-brand-bright" />}
          register={register}
          control={control}
          errors={errors.afternoon}
          disabled={!canManage}
        />
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
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending || !isDirty}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {save.isPending ? "Saving…" : "Save shift times"}
          </button>
          <p className="text-xs text-ink-5">
            {isDirty && !save.isPending ? (
              <span className="font-medium text-warn-deep">
                Unsaved changes ·{" "}
              </span>
            ) : null}
            These pre-fill activity start/end in the shift log and set the shift
            duration OEE is measured against.
          </p>
        </div>
      )}
    </form>
  );
}

/** One shift's clock, with its live duration read-out. */
function ShiftCard({
  slot,
  title,
  icon,
  register,
  control,
  errors,
  disabled,
}: {
  slot: RunningShift;
  title: string;
  icon: React.ReactNode;
  register: UseFormRegister<ShiftTimesValues>;
  control: import("react-hook-form").Control<ShiftTimesValues>;
  errors?: Partial<Record<keyof ShiftClockValues, { message?: string }>>;
  disabled: boolean;
}) {
  // Watch this shift only, so typing in one card doesn't re-render the other.
  const shift = useWatch({ control, name: slot }) as ShiftClockValues;

  const length = shiftLengthMinutes(shift);
  const productive = productiveMinutes(shift);
  const overnight =
    length > 0 &&
    (shift.startTime ?? "") > (shift.endTime ?? "") &&
    shift.endTime !== "";

  const strayBreak =
    (shift.break1Start && !breakIsInsideShift(shift, shift.break1Start)) ||
    (shift.break2Start && !breakIsInsideShift(shift, shift.break2Start));

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon}
          {title}
        </div>
        <div className="text-right text-xs text-ink-4">
          <span className="font-semibold text-ink">
            {formatDuration(length)}
          </span>{" "}
          · {formatDuration(productive)} productive
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Shift start" error={errors?.startTime?.message}>
          <Controller
            name={`${slot}.startTime`}
            control={control}
            render={({ field }) => (
              <TimeField
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={disabled}
                ariaInvalid={Boolean(errors?.startTime)}
              />
            )}
          />
        </Field>
        <Field label="Shift end" error={errors?.endTime?.message}>
          <Controller
            name={`${slot}.endTime`}
            control={control}
            render={({ field }) => (
              <TimeField
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={disabled}
                ariaInvalid={Boolean(errors?.endTime)}
              />
            )}
          />
        </Field>

        <Field label="Break 1 start" error={errors?.break1Start?.message}>
          <Controller
            name={`${slot}.break1Start`}
            control={control}
            render={({ field }) => (
              <TimeField
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={disabled}
              />
            )}
          />
        </Field>
        <Field
          label="Break 1 duration (mins)"
          error={errors?.break1Minutes?.message}
        >
          <input
            type="number"
            min={0}
            max={120}
            disabled={disabled}
            className={FIELD}
            {...register(`${slot}.break1Minutes`, { valueAsNumber: true })}
          />
        </Field>

        <Field label="Break 2 start" error={errors?.break2Start?.message}>
          <Controller
            name={`${slot}.break2Start`}
            control={control}
            render={({ field }) => (
              <TimeField
                value={field.value ?? ""}
                onChange={field.onChange}
                disabled={disabled}
              />
            )}
          />
        </Field>
        <Field
          label="Break 2 duration (mins)"
          error={errors?.break2Minutes?.message}
        >
          <input
            type="number"
            min={0}
            max={120}
            disabled={disabled}
            className={FIELD}
            {...register(`${slot}.break2Minutes`, { valueAsNumber: true })}
          />
        </Field>

        {/* Full width, and last: it belongs to the shift but isn't part of the
            clock. Printed on the shift report — free text, because a
            supervisor covering at short notice may have no login. */}
        <div className="sm:col-span-2">
          <Field
            label="Supervisor on this shift"
            error={errors?.supervisorName?.message}
          >
            <input
              type="text"
              maxLength={80}
              disabled={disabled}
              placeholder="Name — printed on the shift report"
              className={FIELD}
              {...register(`${slot}.supervisorName`)}
            />
          </Field>
        </div>
      </div>

      {(overnight || strayBreak) && (
        <div className="flex items-start gap-2 border-t border-line-soft px-5 py-3 text-xs text-warn-ink">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {strayBreak
              ? "A break starts outside this shift — check the times."
              : "This shift runs past midnight; its length wraps to the next day."}
          </span>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className={LABEL}>{label}</span>
      {children}
      {error && <p className="text-xs text-danger-deep">{error}</p>}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-[340px] animate-pulse rounded-2xl border border-line-soft bg-sunken"
        />
      ))}
    </div>
  );
}
