import { Check } from "lucide-react";

import {
  CAPA_STEPS,
  STEP_INDEX,
  stepLabel,
  type Capa,
  type CapaStep,
} from "@/lib/factory/capa-queries";
import { cn } from "@/lib/utils";

/**
 * Plan → Implement → Verify → Closed, with the current step marked — the
 * reference QMS's stepper (qms-v8), on the CAPA page and the case's Actions
 * tab.
 */
export function CapaStepper({ step, small }: { step: CapaStep; small?: boolean }) {
  const at = STEP_INDEX[step];
  const items = [...CAPA_STEPS.map((s) => s.label), "Closed"];
  return (
    <ol
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1.5",
        small ? "text-xs" : "text-sm",
      )}
    >
      {items.map((label, i) => {
        const done = i < at || (i === 3 && at === 3);
        const current = i === at && at < 3;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && (
              <span
                aria-hidden
                className={cn("h-px w-5 sm:w-8", done || current ? "bg-brand" : "bg-line-strong")}
              />
            )}
            <span
              className={cn(
                "grid shrink-0 place-items-center rounded-full font-semibold",
                small ? "size-5 text-[0.625rem]" : "size-6 text-xs",
                done
                  ? "bg-teal-soft text-teal-deep"
                  : current
                    ? "bg-brand text-white"
                    : "border border-line-strong text-ink-5",
              )}
            >
              {done ? <Check className={small ? "size-3" : "size-3.5"} /> : i < 3 ? i + 1 : ""}
            </span>
            <span
              className={cn(
                "whitespace-nowrap",
                current ? "font-semibold text-ink" : done ? "text-ink-3" : "text-ink-5",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Four dots and where the CAPA stands — the register's Status column. */
export function CapaStepDots({ capa }: { capa: Capa }) {
  const at = STEP_INDEX[capa.step];
  // Withdrawn before approval: no step reached, shown greyed.
  const off = capa.step === "withdrawn";
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap"
      title="Plan → Implement → Verify → Closed"
    >
      <span aria-hidden className="inline-flex gap-1">
        {[0, 1, 2, 3].map((k) => (
          <i
            key={k}
            className={cn(
              "block size-1.5 rounded-full",
              off
                ? "bg-line-strong"
                : k < at || (k === 3 && at === 3)
                ? "bg-teal"
                : k === at
                  ? "bg-brand"
                  : "bg-line-strong",
            )}
          />
        ))}
      </span>
      <span className={cn(capa.step === "closed" || off ? "text-ink-4" : "text-ink")}>
        {stepLabel(capa)}
      </span>
    </span>
  );
}
