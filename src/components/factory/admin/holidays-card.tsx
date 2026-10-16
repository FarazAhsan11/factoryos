"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CalendarOff, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  holidaySchema,
  type HolidayValues,
} from "@/app/factory/[slug]/admin/schemas";
import { DateField } from "@/components/ui/date-picker";
import { formatDay } from "@/lib/factory/dates";
import {
  WEEKDAYS,
  addHolidays,
  dayRun,
  deleteHoliday,
  fetchHolidays,
  fetchWeeklyOff,
  holidayKeys,
  setWeekdayOff,
  weeklyOffKeys,
  type Holiday,
} from "@/lib/factory/holiday-queries";
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:ring-4 focus:ring-brand/12 disabled:bg-sunken disabled:text-ink-5";
const LABEL = "text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-5";

/**
 * Admin → Shift times → Holidays. The days the factory is closed.
 *
 * Picked here and drawn as tinted columns on Pipeline → Room schedule, so a
 * planner can see a stage run into a closure before it does. Advisory — nothing
 * refuses a stage planned onto one — which is why this asks only for the days
 * and an optional name.
 *
 * Saved the moment each is added or removed, not with the shift clock's Save
 * button: they are a list, not a pair that has to be written together.
 */
export function HolidaysCard({
  factoryId,
  canManage,
}: {
  factoryId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const {
    data: holidays = [],
    isPending,
    isError,
    error: loadError,
  } = useQuery({
    queryKey: holidayKeys.all(factoryId),
    queryFn: () => fetchHolidays(factoryId),
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HolidayValues>({
    resolver: zodResolver(holidaySchema),
    defaultValues: { date: "", until: "", label: "" },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: holidayKeys.all(factoryId) });

  const add = useMutation({
    mutationFn: (values: HolidayValues) => {
      const days = dayRun(values.date, values.until || undefined);
      return addHolidays(factoryId, days, values.label?.trim() || null).then(
        () => days.length,
      );
    },
    onSuccess: async (count) => {
      reset({ date: "", until: "", label: "" });
      await refresh();
      toast.success(
        count === 1 ? "Holiday added." : `${count} holiday days added.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (holiday: Holiday) => deleteHoliday(holiday.id),
    onSuccess: async () => {
      await refresh();
      toast.success("Holiday removed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: weeklyOff = [] } = useQuery({
    queryKey: weeklyOffKeys.all(factoryId),
    queryFn: () => fetchWeeklyOff(factoryId),
  });
  const toggleWeekday = useMutation({
    mutationFn: ({ weekday, off }: { weekday: number; off: boolean }) =>
      setWeekdayOff(factoryId, weekday, off),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: weeklyOffKeys.all(factoryId) }),
    onError: (e: Error) => toast.error(e.message),
  });

  const groups = groupByMonth(holidays);

  return (
    <section className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarOff className="size-4 text-violet" aria-hidden />
          Holidays
          {holidays.length > 0 && (
            <span className="rounded-full bg-sunken-2 px-1.5 py-0.5 text-[0.625rem] font-bold text-ink-4">
              {holidays.length}
            </span>
          )}
        </div>
        <p className="text-right text-xs text-ink-5">
          Shown as tinted days on the Room schedule.
        </p>
      </div>

      {/* The weekdays always closed. Saved on each tap, like the list below. */}
      <div className="border-b border-line-soft px-5 py-4">
        <span className={LABEL}>Weekly days off</span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {WEEKDAYS.map((name, weekday) => {
            const off = weeklyOff.includes(weekday);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={off}
                disabled={!canManage || toggleWeekday.isPending}
                onClick={() => toggleWeekday.mutate({ weekday, off: !off })}
                className={cn(
                  "h-9 min-w-12 rounded-full border px-3 text-xs font-semibold transition disabled:cursor-default",
                  off
                    ? "border-violet-line bg-violet-soft text-violet-deep"
                    : "border-line bg-surface text-ink-4",
                  canManage && !off && "hover:border-ink-6 hover:text-ink",
                )}
              >
                {name}
              </button>
            );
          })}
          <p className="text-xs text-ink-5">
            {weeklyOff.length > 0
              ? "These days are closed every week."
              : "Tap a day that is always closed."}
          </p>
        </div>
      </div>

      {canManage && (
        <form
          onSubmit={handleSubmit((values) => add.mutate(values))}
          className="grid gap-3 border-b border-line-soft p-5 sm:grid-cols-[repeat(2,minmax(0,12rem))_minmax(0,1fr)_auto] sm:items-start"
        >
          <div className="space-y-1.5">
            <span className={LABEL}>Day</span>
            <Controller
              name="date"
              control={control}
              render={({ field }) => (
                <DateField
                  ariaLabel="Holiday day"
                  value={field.value}
                  onChange={field.onChange}
                  ariaInvalid={Boolean(errors.date)}
                  placeholder="Pick a day"
                />
              )}
            />
            {errors.date && (
              <p className="text-xs text-danger-deep">{errors.date.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className={LABEL}>
              Until <span className="font-normal normal-case">(optional)</span>
            </span>
            <Controller
              name="until"
              control={control}
              render={({ field }) => (
                <DateField
                  ariaLabel="Last day of the holiday"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  ariaInvalid={Boolean(errors.until)}
                  placeholder="Just this day"
                />
              )}
            />
            {errors.until && (
              <p className="text-xs text-danger-deep">{errors.until.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className={LABEL}>
              Name <span className="font-normal normal-case">(optional)</span>
            </span>
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. Diwali"
              aria-invalid={Boolean(errors.label) || undefined}
              className={FIELD}
              {...register("label")}
            />
            {errors.label && (
              <p className="text-xs text-danger-deep">{errors.label.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={add.isPending}
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60 sm:mt-[1.375rem] sm:self-start"
          >
            {add.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </button>
        </form>
      )}

      <div className="p-5">
        {isPending ? (
          <div className="h-16 animate-pulse rounded-xl bg-sunken" />
        ) : isError ? (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-deep">
            Could not load holidays: {(loadError as Error).message}
          </p>
        ) : holidays.length === 0 ? (
          <p className="text-sm text-ink-5">
            No holidays set.{" "}
            {canManage
              ? "Add the days the factory is closed and they appear on the Room schedule."
              : "A manager adds the days the factory is closed."}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="mb-2 text-[0.6875rem] font-bold tracking-wide text-ink-5 uppercase">
                  {group.title}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {group.items.map((h) => (
                    <li
                      key={h.id}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border border-violet-line bg-violet-soft py-1 pr-1.5 pl-3 text-xs text-violet-deep",
                        !canManage && "pr-3",
                      )}
                    >
                      <span className="font-semibold tabular-nums">
                        {formatDay(h.date)}
                      </span>
                      {h.label && (
                        <span className="text-violet-deep/80">· {h.label}</span>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => remove.mutate(h)}
                          disabled={remove.isPending}
                          aria-label={`Remove holiday ${formatDay(h.date)}`}
                          className="grid size-5 place-items-center rounded-full transition hover:bg-violet-deep/10 disabled:opacity-50"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The list grouped by month, in date order — easier to scan than one run. */
function groupByMonth(holidays: Holiday[]) {
  const groups: { key: string; title: string; items: Holiday[] }[] = [];
  for (const h of holidays) {
    const key = h.date.slice(0, 7);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const [y, m] = key.split("-").map(Number);
      group = { key, title: `${MONTHS[m - 1]} ${y}`, items: [] };
      groups.push(group);
    }
    group.items.push(h);
  }
  return groups;
}
