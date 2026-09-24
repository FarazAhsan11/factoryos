"use client";

import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { Loader2 } from "lucide-react";

import { SelectField, type SelectOptionGroup } from "@/components/ui/select-field";
import { DateField } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";

/**
 * The controls the seven case tabs are built from.
 *
 * One file rather than a copy in each tab: the case form has roughly fifty
 * fields across its tabs, and the first copied class string is the one that
 * drifts. Everything here is presentational and connected by the caller —
 * `register` for the plain inputs, a `Controller` for the two controls that
 * own popovers.
 */

export const CONTROL =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

export const AREA =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

export function Field({
  label,
  htmlFor,
  note,
  hint,
  required,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** "(optional)" and the like — dimmed, beside the label. */
  note?: string;
  /** A sentence under the label, where the field needs one. */
  hint?: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
        {note && <span className="ml-1 text-[10px] text-ink-5">{note}</span>}
      </label>
      {hint && <p className="text-[11px] leading-snug text-ink-5">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="text-[11.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A `DateField` wired through a Controller — it owns a popover, so it is controlled. */
export function DateControl<T extends FieldValues>({
  control,
  name,
  id,
  placeholder = "Not set",
  invalid,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <DateField
          id={id}
          value={(field.value as string) ?? ""}
          onChange={field.onChange}
          placeholder={placeholder}
          ariaInvalid={invalid}
        />
      )}
    />
  );
}

/** The same for `SelectField`, which is the only dropdown this app draws. */
export function SelectControl<T extends FieldValues>({
  control,
  name,
  id,
  options,
  groups,
  placeholder,
  clearable,
  clearLabel,
  searchPlaceholder,
  emptyMessage,
  invalid,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  id?: string;
  options?: { value: string; label: string; meta?: string; hint?: string }[];
  groups?: SelectOptionGroup[];
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  invalid?: boolean;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <SelectField
          id={id}
          value={(field.value as string) ?? ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
          options={options}
          groups={groups}
          placeholder={placeholder}
          clearable={clearable}
          clearLabel={clearLabel}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          ariaInvalid={invalid}
        />
      )}
    />
  );
}

/**
 * A yes/no pair with **no default**, and a third state: unanswered.
 *
 * The same control the maintenance request uses, and for the same reason — a
 * box nobody touched must not print as a confident "No" on a document
 * somebody signs.
 */
export function YesNo<T extends FieldValues>({
  control,
  name,
}: {
  control: Control<T>;
  name: FieldPath<T>;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className="flex gap-2">
          {(["yes", "no"] as const).map((value) => {
            const active = field.value === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => field.onChange(active ? "" : value)}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition",
                  active
                    ? "border-brand bg-brand-soft text-brand-deep ring-2 ring-brand/15"
                    : "border-line bg-surface text-ink-3 hover:border-line-strong",
                )}
              >
                {value === "yes" ? "Yes" : "No"}
              </button>
            );
          })}
        </div>
      )}
    />
  );
}

/** The heading over a block of fields inside a tab. */
export function Group({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <p className="text-[10px] font-bold tracking-[0.09em] text-ink-4 uppercase">
        {title}
      </p>
      {children}
    </section>
  );
}

/** A three-column field grid — the shape the reference form uses. */
export function Cols({
  children,
  of = 3,
}: {
  children: React.ReactNode;
  of?: 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        of === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

/** One recorded value, read-only — what a closed case shows instead of a form. */
export function Fact({
  label,
  children,
  wide,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-[13px] text-ink",
          mono && "font-mono",
          wide ? "break-words whitespace-pre-wrap" : "truncate",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-5 italic">{children}</span>;
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1 ring-current/15",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The save button every tab ends with. */
export function SaveBar({
  pending,
  label = "Save",
  children,
}: {
  pending: boolean;
  label?: string;
  /** A note beside the button — what this save will not do. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
      <p className="text-[11px] text-ink-5">{children}</p>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}

/** "14 Aug 2026", or a dash. Dates here are plain `YYYY-MM-DD` strings. */
export function formatDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
