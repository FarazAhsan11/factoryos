"use client";

import { useState } from "react";
import { useController, type Control, type FieldPath } from "react-hook-form";

import type {
  LogEntryParsed,
  LogEntryValues,
} from "@/app/factory/[slug]/log/schemas";
import { CONTROL, Field } from "@/components/factory/log/log-fields";
import { SelectField } from "@/components/ui/select-field";
import type { Employee } from "@/lib/factory/employee-queries";
import type { RunningShift } from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/** Sentinel option: someone who isn't on the roster (contractor, cover staff). */
const OTHER = "__other__";

export function employeeName(employee: Employee): string {
  return employee.full_name?.trim() || employee.email;
}

/**
 * Picks an operator from the factory's roster. People rostered on the shift
 * being logged come first, because that's who it almost always is.
 *
 * The stored value is the person's *name*, not their id: a shift record has
 * to keep saying who ran the machine even if that account is later renamed or
 * removed. That's also why "Not on the list" stays available — cover staff and
 * contractors work real shifts without ever having a login.
 */
export function OperatorPicker({
  control,
  name,
  label,
  note,
  optional,
  action,
  employees,
  shift,
  exclude,
}: {
  control: Control<LogEntryValues, unknown, LogEntryParsed>;
  name: Extract<FieldPath<LogEntryValues>, `operators.${number}.name`>;
  label: string;
  note?: string;
  /** Marks the field as skippable — set for waiting-time activities. */
  optional?: boolean;
  /** Rendered opposite the label — the "Remove" button on an added operator. */
  action?: React.ReactNode;
  employees: Employee[];
  shift: RunningShift;
  /** Names already chosen in the other rows, so nobody is picked twice. */
  exclude?: string[];
}) {
  const { field, fieldState } = useController({ control, name });
  const value = (field.value as string | undefined) ?? "";

  const taken = new Set(exclude ?? []);
  const roster = employees
    .map(employeeName)
    .filter((n) => n && !taken.has(n))
    .sort((a, b) => a.localeCompare(b));

  const onShift = employees
    .filter((e) => e.default_shift === shift || e.default_shift === "both")
    .map(employeeName)
    .filter((n) => n && !taken.has(n));
  const onShiftSet = new Set(onShift);
  const others = roster.filter((n) => !onShiftSet.has(n));

  // A value that isn't on the roster means it was typed — keep the free-text
  // box open so it stays editable instead of silently resetting.
  const [freeText, setFreeText] = useState(
    () => Boolean(value) && !roster.includes(value),
  );

  const selectValue = freeText ? OTHER : roster.includes(value) ? value : "";

  return (
    <Field
      label={label}
      note={note}
      optional={optional}
      action={action}
      error={fieldState.error?.message}
    >
      {/* On a producing or machine activity every row that exists is
          required — an unwanted one is removed, not left blank. On waiting
          time it may simply be left here, and the entry files without it. */}
      <SelectField
        ariaLabel={label}
        value={selectValue}
        onChange={(next) => {
          if (next === OTHER) {
            setFreeText(true);
            field.onChange("");
            return;
          }
          setFreeText(false);
          field.onChange(next);
        }}
        onBlur={field.onBlur}
        clearable
        ariaInvalid={Boolean(fieldState.error)}
        // A roster of forty is exactly the list the search box is for, and
        // "Not on the list" is the last row rather than a group of its own —
        // it is an escape hatch, not a third category of person.
        searchPlaceholder="Name…"
        emptyMessage="Nobody on the roster matches that."
        groups={[
          ...(onShift.length > 0
            ? [
                {
                  label: `On ${shift} shift`,
                  options: [...onShift]
                    .sort((a, b) => a.localeCompare(b))
                    .map((n) => ({ value: n, label: n })),
                },
              ]
            : []),
          ...(others.length > 0
            ? [
                {
                  label: "Other staff",
                  options: others.map((n) => ({ value: n, label: n })),
                },
              ]
            : []),
          // Headless, so it reads as a footer to the roster rather than a
          // third category of person — and pinned, because typing a name the
          // roster doesn't have is exactly when it is needed.
          {
            label: "",
            options: [
              { value: OTHER, label: "Not on the list…", pinned: true },
            ],
          },
        ]}
      />

      {freeText && (
        <input
          autoFocus
          className={cn(CONTROL, "mt-1.5")}
          placeholder="Type the name"
          value={value}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          aria-label={`${label} — name`}
        />
      )}
    </Field>
  );
}
