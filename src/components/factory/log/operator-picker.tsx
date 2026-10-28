"use client";

import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import { CONTROL, Field } from "@/components/factory/log/log-fields";
import { WorkerSelect } from "@/components/factory/worker-select";
import type { RunningShift } from "@/lib/factory/shift-time-queries";
import type { Worker } from "@/lib/factory/worker-queries";

/**
 * Picks an operator from the factory's workforce (Resources → Workforce).
 * People on the shift being logged come first, because that's who it almost
 * always is.
 *
 * The stored value is the person's *name*, not their id: a shift record has
 * to keep saying who ran the machine even if that person is later renamed or
 * removed. That's also why "Not on the list" stays available — cover staff and
 * contractors work real shifts without ever being on the register. Both rules
 * live in `WorkerSelect`; this is that control bound to one row of a log form.
 */
export function OperatorPicker<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TParsed,
>({
  control,
  name,
  label,
  note,
  optional,
  action,
  workers,
  shift,
  exclude,
}: {
  /**
   * Generic over the form it belongs to rather than tied to `LogEntryValues`:
   * the shift report's edit dialog is the same fields plus an amendment note,
   * and pinning the picker to one of the two schemas would mean a second copy
   * of the on-shift grouping and the "Not on the list…" escape hatch —
   * behaviours that must not drift between filing an entry and correcting one.
   */
  control: Control<TValues, unknown, TParsed>;
  name: TName;
  label: string;
  note?: string;
  /** Marks the field as skippable — set for waiting-time activities. */
  optional?: boolean;
  /** Rendered opposite the label — the "Remove" button on an added operator. */
  action?: React.ReactNode;
  workers: Worker[];
  shift: RunningShift;
  /** Names already chosen in the other rows, so nobody is picked twice. */
  exclude?: string[];
}) {
  const { field, fieldState } = useController<TValues, TName, TParsed>({
    control,
    name,
  });

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
      <WorkerSelect
        value={(field.value as string | undefined) ?? ""}
        onChange={field.onChange}
        onBlur={field.onBlur}
        workers={workers}
        shift={shift}
        exclude={exclude}
        placeholder="Select…"
        ariaLabel={label}
        ariaInvalid={Boolean(fieldState.error)}
        inputClassName={CONTROL}
      />
    </Field>
  );
}
