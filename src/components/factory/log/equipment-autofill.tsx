"use client";

import type { Equipment } from "@/lib/factory/equipment-queries";
import { cn } from "@/lib/utils";

/**
 * What the typed equipment number resolved to in Admin → Equipment.
 *
 * The same contract as `BatchAutofill`: the operator types the number off the
 * machine, and the name is read back out of the register rather than retyped
 * into a shift record — so a machine renamed once in Admin is renamed
 * everywhere, and a number that matches nothing says so on the spot instead of
 * surfacing weeks later in a report nobody can read.
 */
export function EquipmentAutofill({
  query,
  equipment,
}: {
  /** The raw text in the field, so we can tell "empty" from "no match". */
  query: string;
  equipment: Equipment | null;
}) {
  if (!equipment) {
    return (
      <p
        className={cn(
          "text-xs italic",
          query ? "text-danger-deep" : "text-ink-5",
        )}
      >
        {query
          ? `No match for “${query}” — check Admin → Equipment.`
          : "Type an equipment number to auto-fill the machine name."}
      </p>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl border border-brand-soft bg-brand-tint px-3.5 py-2.5 text-xs">
      <span className="text-ink-4">Machine</span>
      <span className="truncate font-medium text-ink">
        {equipment.name}
        {!equipment.active && (
          // Retired, not missing. The entry is still allowed — a machine can
          // be logged against on the day it is taken out of service — but the
          // supervisor reading it should know it is off the register.
          <span className="ml-2 rounded-full bg-sunken-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-4">
            Retired
          </span>
        )}
      </span>
    </div>
  );
}
