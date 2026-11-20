import { Check } from "lucide-react";

import {
  CAPA_STEPS,
  CAPA_STEP_LABEL,
  STEP_INDEX,
  type CapaStep,
} from "@/lib/factory/capa-queries";
import { cn } from "@/lib/utils";

/**
 * CAPA plan → Do → Effectiveness check → Closed, with the current step
 * marked — the reference QMS's stepper (qms-v6), on the CAPA page and the
 * case's Actions tab.
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

/** Four dots and the step's name — the register's Step column. */
export function CapaStepDots({ step }: { step: CapaStep }) {
  const at = STEP_INDEX[step];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className="inline-flex gap-1">
        {[0, 1, 2, 3].map((k) => (
          <i
            key={k}
            className={cn(
              "block size-1.5 rounded-full",
              k < at || (k === 3 && at === 3)
                ? "bg-teal"
                : k === at
                  ? "bg-brand"
                  : "bg-line-strong",
            )}
          />
        ))}
      </span>
      <span className={cn(step === "closed" ? "text-ink-4" : "text-ink")}>
        {step === "closed" ? "Closed" : `${at + 1} · ${CAPA_STEP_LABEL[step]}`}
      </span>
    </span>
  );
}
