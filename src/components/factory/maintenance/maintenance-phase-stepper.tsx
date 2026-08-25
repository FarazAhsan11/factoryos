"use client";

import { Check } from "lucide-react";

import {
  PHASE_OF,
  type MaintenancePhase,
  type MaintenanceRequest,
} from "@/lib/factory/maintenance-queries";
import { cn } from "@/lib/utils";

/**
 * Where the request has got to, in the paper form's own terms.
 *
 * Three steps, not five, because three is what is printed on the document and
 * what people say out loud — "it's with engineering", "QA hasn't signed it".
 * The five statuses are the machinery underneath; showing them here would put
 * a distinction on screen that nobody on the floor makes.
 *
 * A phase is *done* when the request has moved past it, not when it has been
 * typed into: Section 2 is full of text the moment the fitter starts writing,
 * and a tick against it before it was signed would be a lie the auditor
 * notices before you do.
 */
const PHASES: { key: MaintenancePhase; n: number; label: string }[] = [
  { key: "initiation", n: 1, label: "Initiation" },
  { key: "engineering", n: 2, label: "Engineering" },
  { key: "qa", n: 3, label: "QA review" },
];

const ORDER: Record<MaintenancePhase, number> = {
  initiation: 0,
  engineering: 1,
  qa: 2,
};

export function MaintenancePhaseStepper({
  request,
  className,
}: {
  request: MaintenanceRequest;
  className?: string;
}) {
  const current = ORDER[PHASE_OF[request.status]];
  // Verified is the one status where the last phase is behind you rather than
  // around you, so nothing is "current" and all three carry a tick.
  const finished = request.status === "verified";

  return (
    <ol className={cn("flex items-center gap-1", className)}>
      {PHASES.map((phase, i) => {
        const done = finished || i < current;
        const active = !finished && i === current;

        return (
          <li key={phase.key} className="flex min-w-0 flex-1 items-center gap-1">
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5",
                active && "bg-[#EFF6FF]",
                done && "bg-[#F0FDF4]",
                !active && !done && "bg-[#F8FAFC]"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  done
                    ? "bg-[#16A34A] text-white"
                    : active
                      ? "bg-[#2563EB] text-white"
                      : "bg-[#E2E8F0] text-[#94A3B8]"
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : phase.n}
              </span>
              <span
                className={cn(
                  "truncate text-[11px] font-semibold",
                  done
                    ? "text-[#15803D]"
                    : active
                      ? "text-[#1D4ED8]"
                      : "text-[#94A3B8]"
                )}
              >
                {phase.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
