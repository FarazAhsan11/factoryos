"use client";

import { useState } from "react";

import { FIELD } from "@/components/factory/admin/settings-ui";
import {
  SelectField,
  type SelectOption,
  type SelectOptionGroup,
} from "@/components/ui/select-field";
import type { Worker } from "@/lib/factory/worker-queries";
import { cn } from "@/lib/utils";

/** Sentinel option: someone who isn't on the register (contractor, cover). */
const OTHER = "__other__";
/** A disabled row that says why the list is empty and where to fill it. */
const NOBODY = "__nobody__";

/**
 * Names a person from Resources → Workforce: a shift's operators, the fitter a
 * breakdown is assigned to, whoever investigates an issue or owns a deviation's
 * action. Every "who did / who will" field in the workspace is this control,
 * so the register is the one place a name is spelled.
 *
 * Controlled, with the SelectField contract — a string in, a string out, `""`
 * for empty — so a form connects it with `Controller`. The value is the
 * person's *name*, not their row id: a record has to keep saying who did the
 * work after that person is renamed or leaves the register.
 *
 * "Not on the list…" opens a typed name, because contractors and cover staff
 * do real work without ever being on the register, and a stored name the
 * register doesn't hold opens the same way — kept as typed, never reset.
 */
export function WorkerSelect({
  id,
  value,
  onChange,
  onBlur,
  workers,
  shift,
  exclude,
  placeholder = "Select a person…",
  ariaLabel = "Person",
  ariaInvalid,
  className,
  inputClassName = FIELD,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  workers: Worker[];
  /**
   * The shift being recorded. When given, that shift's people (and the
   * rotating ones) are listed first, because it is almost always one of them.
   */
  shift?: string;
  /** Names already chosen elsewhere in the form, so nobody is picked twice. */
  exclude?: string[];
  placeholder?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  className?: string;
  /** The typed-name box's look, so it matches the form it sits in. */
  inputClassName?: string;
}) {
  const taken = new Set(exclude ?? []);
  const available = workers
    .filter((w) => !taken.has(w.full_name))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const names = new Set(available.map((w) => w.full_name));

  // Set when "Not on the list…" is picked, so the box stays open while it is
  // still empty. A stored name the register doesn't hold opens it too —
  // derived rather than captured once, so a list that arrives after the form
  // still resolves a name it does hold.
  const [typing, setTyping] = useState(false);
  const freeText = typing || (value !== "" && !names.has(value));

  const option = (w: Worker): SelectOption => ({
    value: w.full_name,
    label: w.full_name,
    meta: w.role,
  });

  const onShift = (w: Worker) => w.shift === shift || w.shift === "both";
  const groups: SelectOptionGroup[] = shift
    ? [
        {
          label: `On ${shift} shift`,
          options: available.filter(onShift).map(option),
        },
        {
          label: "Other staff",
          options: available.filter((w) => !onShift(w)).map(option),
        },
      ]
    : [{ label: "Workforce", options: available.map(option) }];

  return (
    <div className={className}>
      <SelectField
        id={id}
        value={freeText ? OTHER : value}
        onChange={(next) => {
          if (next === OTHER) {
            setTyping(true);
            onChange("");
            return;
          }
          setTyping(false);
          onChange(next);
        }}
        onBlur={onBlur}
        placeholder={placeholder}
        clearable
        ariaLabel={ariaLabel}
        ariaInvalid={ariaInvalid}
        // The role is in the list beside every name; on the trigger it only
        // crowds the name out.
        showMeta={false}
        searchPlaceholder="Name…"
        emptyMessage="Nobody on the workforce matches that."
        groups={[
          ...groups.filter((g) => g.options.length > 0),
          // Headless, so it reads as a footer to the list rather than a
          // category of person — and pinned, because typing a name the list
          // doesn't have is exactly when it is needed.
          {
            label: "",
            options: [
              ...(workers.length === 0
                ? [
                    {
                      value: NOBODY,
                      label: "No one on the workforce yet",
                      hint: "Add people in Plant setup → Resources → Workforce.",
                      disabled: true,
                    },
                  ]
                : []),
              { value: OTHER, label: "Not on the list…", pinned: true },
            ],
          },
        ]}
      />

      {freeText && (
        <input
          // Only when the person asked for the box: a stored name shown
          // typed must not pull focus away from the form's first field.
          autoFocus={typing}
          className={cn(inputClassName, "mt-1.5")}
          placeholder="Type the name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-label={`${ariaLabel} — name`}
        />
      )}
    </div>
  );
}
