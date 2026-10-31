"use client";

import { useSyncExternalStore } from "react";
import { Building2, ChevronDown, Clock3, Moon, Sun, UserRound } from "lucide-react";

import { ShiftReportSummary } from "@/components/factory/report/shift-report-summary";
import {
  formatReportDate,
  type ShiftReportTotals,
} from "@/lib/factory/shift-report-queries";
import type {
  RunningShift,
  ShiftClock,
} from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "factoryos:shift-report-details";

/* Whether the details are open is one viewer's preference, kept in the browser,
   which makes it an external store rather than React state — see the same
   arrangement in `sidebar-context.tsx`. Closed by default: the table is what
   people come for, and the height belongs to it. */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // private mode / blocked storage — the default stands
  }
}

function writeOpen(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* the preference simply doesn't persist */
  }
  listeners.forEach((listener) => listener());
}

const serverOpen = () => false;

/**
 * The masthead of the sheet: one slim bar saying which shift and how it went,
 * with the rest of the document's particulars folded away under Details.
 *
 * The bar is what a reader needs every time; the factory, the clock and the
 * supervisor are what a filed copy needs. So the details fold on screen and
 * **never on paper**: a printed shift report handed to the next shift with no
 * window and no supervisor is a table of numbers nobody can file — which is why
 * the supervisor gets a column in Admin → Shift times.
 */
export function ShiftReportHeader({
  factoryName,
  date,
  shift,
  clock,
  unitWord,
  unitWordPlural,
  totals,
}: {
  factoryName: string;
  date: string;
  shift: RunningShift;
  clock: ShiftClock | undefined;
  unitWord: string;
  unitWordPlural: string;
  totals: ShiftReportTotals;
}) {
  const open = useSyncExternalStore(subscribe, readOpen, serverOpen);
  const morning = shift === "morning";
  const supervisor = clock?.supervisorName?.trim();

  return (
    <header
      className={cn(
        "shrink-0 border-b border-line",
        // A whisper of the shift's own colour across the top of the sheet —
        // enough to tell a morning report from an afternoon one at a glance
        // on a desk, not enough to survive as ink on a photocopier.
        morning
          ? "bg-[linear-gradient(105deg,var(--color-warn-tint)_0%,var(--color-surface)_45%)]"
          : "bg-[linear-gradient(105deg,var(--color-brand-tint)_0%,var(--color-surface)_45%)]",
        "print:rounded-none print:bg-none",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 print:px-0">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg ring-1",
              morning
                ? "bg-warn-soft text-warn-deep ring-warn-line"
                : "bg-brand-soft text-brand-deep ring-brand-line",
              "print:hidden",
            )}
          >
            {morning ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
          </span>
          <h2 className="text-[0.9375rem] font-semibold tracking-tight whitespace-nowrap text-ink">
            {morning ? "Morning" : "Afternoon"} shift
            <span className="ml-2 font-normal text-ink-4">
              {formatReportDate(date)}
            </span>
          </h2>
        </div>

        <ShiftReportSummary
          totals={totals}
          unitWordPlural={unitWordPlural}
          className="sm:ml-auto"
        />

        <button
          type="button"
          onClick={() => writeOpen(!open)}
          aria-expanded={open}
          aria-controls="shift-report-details"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[0.6875rem] font-semibold text-ink-4 transition hover:bg-surface hover:text-brand focus-visible:ring-3 focus-visible:ring-brand/25 focus-visible:outline-none print:hidden"
        >
          Details
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      {/* Rows from 0fr to 1fr, the one way to animate to a height nobody has
          to state. Open regardless on paper. */}
      <div
        id="shift-report-details"
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out print:grid-rows-[1fr]",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <dl className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-line-soft px-4 py-2 print:border-0 print:px-0">
            <Fact icon={Building2} label={`${unitWord} summary`}>
              {factoryName}
            </Fact>
            {clock?.startTime && clock?.endTime && (
              <Fact icon={Clock3} label="Shift window">
                <span className="font-mono">
                  {clock.startTime} → {clock.endTime}
                </span>
              </Fact>
            )}
            {/* Only when there is one. "Supervisor: —" on a handover sheet
                reads as nobody was in charge, which is worse than silence. */}
            {supervisor && (
              <Fact icon={UserRound} label="Supervisor">
                {supervisor}
              </Fact>
            )}
          </dl>
        </div>
      </div>
    </header>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock3;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface text-ink-5 ring-1 ring-line print:hidden"
      >
        <Icon className="size-3.5" />
      </span>
      <div>
        <dt className="text-[0.625rem] font-bold uppercase tracking-[0.07em] text-ink-5">
          {label}
        </dt>
        <dd className="text-[0.8125rem] font-semibold text-ink">{children}</dd>
      </div>
    </div>
  );
}
