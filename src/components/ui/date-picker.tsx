"use client";

import { useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  X,
} from "lucide-react";

import { minutesNow, useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/**
 * Date and date-time pickers, built on the palette rather than on the
 * browser's own widget.
 *
 * A native `<input type="date">` is a different control in every browser — a
 * grey wedge in Chrome, a text field with no picker at all in Safari on some
 * platforms — and none of them can be styled. On a factory floor where the
 * same screen is read on a Windows tablet and a phone, that is three products.
 *
 * The value format is deliberately identical to the native inputs these
 * replace: `YYYY-MM-DD` for a date and `YYYY-MM-DDTHH:mm` for a date-time. So
 * are `min` and `max`. Anything reading or writing these fields — a zod
 * schema, a Supabase filter, an existing `todayKey()` comparison — cannot
 * tell the difference.
 *
 * No date library: everything here is local-time `Date` arithmetic on the
 * year/month/day components. That is not thrift, it is correctness — parsing
 * "2026-08-28" with `new Date(iso)` reads it as UTC and lands on the 27th for
 * anyone west of Greenwich, which is exactly the class of bug a shift log
 * cannot afford.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Local `YYYY-MM-DD` — never `toISOString()`, which shifts to UTC. */
function toKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** `YYYY-MM-DD` → a local midnight Date, or null if it isn't one. */
function fromKey(key: string | undefined | null): Date | null {
  if (!key) return null;
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "28 Aug 2026" — the year kept, because these are records people file.
 *
 * Built from a fixed month table rather than toLocaleDateString(undefined).
 * An undefined locale means *the environment*, and the trigger renders on the
 * server before it renders in the browser: Node formatted "Sep 5, 2026" where
 * the browser formatted "5 Sept 2026", and React reported the hydration
 * mismatch against this span. Every other date in the app that survives a
 * server pass is written the same way.
 */
function longDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The six-week grid for a month, Monday-first, padded with the neighbouring
 * months so every row is seven cells and the grid never changes height.
 */
function monthGrid(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  // getDay() is Sunday-first; shift so Monday is column 0.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);

  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
}

const TRIGGER =
  "flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-left text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition hover:border-line-strong focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/12 data-popup-open:border-brand data-popup-open:ring-4 data-popup-open:ring-brand/12 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70";

const POPUP =
  "z-50 w-[19rem] origin-(--transform-origin) rounded-2xl border border-line bg-surface p-3 shadow-[0_24px_60px_-20px_rgb(20_22_43/0.45)] ring-1 ring-ink/5 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

/** The month grid, shared by both pickers. */
function Calendar({
  selected,
  min,
  max,
  onPick,
}: {
  selected: Date | null;
  min?: string;
  max?: string;
  onPick: (date: Date) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState(
    () => selected ?? new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const minDate = fromKey(min);
  const maxDate = fromKey(max);
  const days = useMemo(() => monthGrid(view), [view]);

  function shiftMonth(by: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + by, 1));
  }

  function outOfRange(day: Date): boolean {
    if (minDate && day < minDate) return true;
    if (maxDate && day > maxDate) return true;
    return false;
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken hover:text-brand"
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-[13px] font-semibold text-ink">
          {view.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken hover:text-brand"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            aria-hidden
            className="grid h-7 place-items-center text-[10px] font-bold tracking-[0.06em] text-ink-5 uppercase"
          >
            {day}
          </span>
        ))}

        {days.map((day) => {
          const inMonth = day.getMonth() === view.getMonth();
          const isSelected = selected !== null && sameDay(day, selected);
          const isToday = sameDay(day, today);
          const disabled = outOfRange(day);

          return (
            <button
              key={day.getTime()}
              type="button"
              disabled={disabled}
              onClick={() => onPick(day)}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className={cn(
                "grid h-9 place-items-center rounded-lg text-[13px] tabular-nums transition",
                isSelected
                  ? "bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] font-bold text-white shadow-brand-sm"
                  : disabled
                    ? "cursor-not-allowed text-ink-6/60"
                    : inMonth
                      ? "font-medium text-ink hover:bg-brand-soft hover:text-brand-deep"
                      : "text-ink-6 hover:bg-sunken",
                // Today is ringed rather than filled, so it never competes
                // with the day actually chosen.
                isToday && !isSelected && "ring-1 ring-brand-line ring-inset",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** The row of shortcuts under the grid. */
function Footer({
  onToday,
  onClear,
  todayDisabled,
  clearDisabled,
  children,
}: {
  onToday: () => void;
  onClear: () => void;
  todayDisabled?: boolean;
  clearDisabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line-soft pt-2.5">
      <button
        type="button"
        onClick={onToday}
        disabled={todayDisabled}
        className="rounded-lg px-2 py-1 text-xs font-semibold text-brand transition hover:bg-brand-soft disabled:pointer-events-none disabled:opacity-40"
      >
        Today
      </button>
      <div className="flex items-center gap-1">
        {children}
        <button
          type="button"
          onClick={onClear}
          disabled={clearDisabled}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-4 transition hover:bg-sunken hover:text-danger-deep disabled:pointer-events-none disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * A date field. Emits `YYYY-MM-DD` — or `""` when cleared — exactly like the
 * `<input type="date">` it replaces.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder = "Pick a date",
  title,
  className,
  ariaLabel,
  ariaInvalid,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  /** `YYYY-MM-DD`, inclusive — same meaning as the native attribute. */
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  className?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromKey(value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        className={cn(TRIGGER, className)}
      >
        <CalendarDays className="size-4 shrink-0 text-ink-5" />
        <span
          className={cn("flex-1 truncate", !selected && "text-placeholder")}
        >
          {selected ? longDate(selected) : placeholder}
        </span>
        {selected && !disabled && (
          // A span, not a button: nesting a button inside the trigger is
          // invalid, and the trigger's own click is suppressed here instead.
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date"
            onPointerDown={(event) => {
              // pointerdown, not click: the trigger opens on pointerdown, so
              // stopping only the click would clear the value *and* open the
              // popover.
              event.preventDefault();
              event.stopPropagation();
              onChange("");
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-ink-5 transition hover:bg-sunken hover:text-danger-deep"
          >
            <X className="size-3.5" />
          </span>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className={POPUP}>
            <Calendar
              selected={selected}
              min={min}
              max={max}
              onPick={(day) => {
                onChange(toKey(day));
                setOpen(false);
              }}
            />
            <Footer
              onToday={() => {
                onChange(toKey(new Date()));
                setOpen(false);
              }}
              onClear={() => {
                onChange("");
                setOpen(false);
              }}
              clearDisabled={!value}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A date-and-time field. Emits `YYYY-MM-DDTHH:mm` — or `""` — exactly like
 * the `<input type="datetime-local">` it replaces.
 *
 * Picking a day when no time is set defaults to 09:00 rather than midnight:
 * a due date of "Friday" means Friday's shift, and 00:00 makes a deadline
 * that was already missed before anyone read it.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder = "Pick a date and time",
  className,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const datePart = value.slice(0, 10);
  const timePart = value.length >= 16 ? value.slice(11, 16) : "";
  const selected = fromKey(datePart);

  function commit(nextDate: string, nextTime: string) {
    if (!nextDate) return onChange("");
    onChange(`${nextDate}T${nextTime || "09:00"}`);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(TRIGGER, className)}
      >
        <CalendarDays className="size-4 shrink-0 text-ink-5" />
        <span
          className={cn("flex-1 truncate", !selected && "text-placeholder")}
        >
          {selected ? (
            <>
              {longDate(selected)}
              <span className="ml-1.5 font-mono text-[13px] text-ink-4">
                {timePart || "09:00"}
              </span>
            </>
          ) : (
            placeholder
          )}
        </span>
        {selected && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date and time"
            onPointerDown={(event) => {
              // pointerdown, not click: the trigger opens on pointerdown, so
              // stopping only the click would clear the value *and* open the
              // popover.
              event.preventDefault();
              event.stopPropagation();
              onChange("");
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-ink-5 transition hover:bg-sunken hover:text-danger-deep"
          >
            <X className="size-3.5" />
          </span>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className={POPUP}>
            <Calendar
              selected={selected}
              min={min}
              max={max}
              onPick={(day) => commit(toKey(day), timePart)}
            />

            {/* The time stays a native `time` input: it is a two-field spinner
                rather than a widget, it is the same in every browser, and it
                takes typed input — which is faster than any list of options
                once you know the number you want. */}
            <div className="mt-2.5 flex items-center gap-2 border-t border-line-soft pt-2.5">
              <Clock3 className="size-4 shrink-0 text-ink-5" />
              <label htmlFor={`${id ?? "dt"}-time`} className="sr-only">
                Time
              </label>
              <TimeField
                id={`${id ?? "dt"}-time`}
                value={timePart || "09:00"}
                onChange={(next) => commit(datePart, next)}
                ariaLabel="Time"
                className="h-9 flex-1"
              />
            </div>

            <Footer
              onToday={() => commit(toKey(new Date()), timePart)}
              onClear={() => {
                onChange("");
                setOpen(false);
              }}
              clearDisabled={!value}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-[1.06]"
              >
                Done
              </button>
            </Footer>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ── Time ─────────────────────────────────────────────────────────────────
   The native `<input type="time">` is the worst of the three: Chrome draws a
   blue spinner nobody asked for, Firefox draws a plain box, and on a phone it
   becomes a full-screen wheel. All of them show AM/PM while the rest of this
   app — the shift windows, the report header, the feed — speaks 24-hour.

   Same contract as the input it replaces: `HH:mm`, or `""` when cleared. */

/** A scrolling column of numbers, with the chosen one kept in view. */
function NumberColumn({
  label,
  values,
  active,
  onPick,
}: {
  label: string;
  values: number[];
  active: number | null;
  onPick: (value: number) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-center text-[10px] font-bold tracking-[0.06em] text-ink-5 uppercase">
        {label}
      </p>
      <ul
        ref={listRef}
        className="scrollbar-slim h-44 overflow-y-auto rounded-xl border border-line bg-sunken p-1"
      >
        {values.map((value) => {
          const on = value === active;
          return (
            <li key={value}>
              <button
                type="button"
                // Centres the chosen value when the popup opens on 23:47
                // rather than 00:00. Deliberately *not* `scrollIntoView`:
                // that scrolls every scrollable ancestor too, so opening a
                // time picker inside a dialog would yank the dialog with it.
                ref={(node) => {
                  const list = listRef.current;
                  if (!on || !node || !list) return;
                  list.scrollTop =
                    node.offsetTop -
                    list.clientHeight / 2 +
                    node.clientHeight / 2;
                }}
                onClick={() => onPick(value)}
                aria-pressed={on}
                className={cn(
                  "w-full rounded-lg py-1.5 text-center font-mono text-[13px] tabular-nums transition",
                  on
                    ? "bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] font-bold text-white shadow-brand-sm"
                    : "text-ink-3 hover:bg-surface hover:text-brand-deep",
                )}
              >
                {String(value).padStart(2, "0")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** "HH:MM" → minutes since midnight, or null if it isn't one. */
function toMinutes(clock: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(clock ?? "");
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 1440 ? mins : null;
}

/**
 * A 24-hour time field. Emits `HH:mm`, or `""` when cleared.
 *
 * Minutes run one by one rather than in five-minute steps: an activity that
 * started at 15:07 started at 15:07, and a picker that can only say 15:05 is
 * a picker that quietly falsifies a duration.
 *
 * `from` and `to` narrow it to a window — the hours outside are not listed at
 * all, and the minutes of a boundary hour are cut to the part that falls
 * inside. A window that runs past midnight (22:00 → 06:00) is understood as
 * one, not as an empty range.
 */
export function TimeField({
  id,
  value,
  onChange,
  disabled,
  placeholder = "--:--",
  className,
  ariaLabel,
  ariaInvalid,
  from,
  to,
  windowNote,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  /** Earliest selectable time, "HH:MM". Both ends or neither. */
  from?: string;
  /** Latest selectable time, "HH:MM", inclusive. */
  to?: string;
  /** Why the list is short — shown in the popup above the columns. */
  windowNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  const hour = match ? Number(match[1]) : null;
  const minute = match ? Number(match[2]) : null;
  const set = (h: number | null, m: number | null) =>
    onChange(
      `${String(h ?? 0).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`,
    );

  /**
   * The window, as minutes since midnight — or null, meaning the whole day.
   *
   * Both ends or neither: half a window is a rule nobody can state, and
   * silently treating a missing end as midnight would cut a night shift in
   * half at exactly the point it is busiest.
   */
  const fromMin = toMinutes(from);
  const toMin = toMinutes(to);
  const bounded = fromMin !== null && toMin !== null;
  /** 22:00 → 06:00 is a window, not an empty range. */
  const wraps = bounded && fromMin > toMin;

  const inWindow = (mins: number) =>
    !bounded ||
    (wraps
      ? mins >= fromMin! || mins <= toMin!
      : mins >= fromMin! && mins <= toMin!);

  // An hour is offered when any minute of it falls inside — the boundary hours
  // are then cut down by the minute column rather than dropped whole.
  const hours = bounded
    ? HOURS.filter((h) => MINUTES.some((m) => inWindow(h * 60 + m)))
    : HOURS;
  const minutes =
    bounded && hour !== null
      ? MINUTES.filter((m) => inWindow(hour * 60 + m))
      : MINUTES;

  // "Now" outside the window would write a time the window forbids, so it is
  // offered only when it is a legal answer. The clock is read through a hook
  // so it is current on every render — see `useRenderClock`.
  const nowMinutes = useRenderClock(minutesNow);
  const nowAllowed = inWindow(nowMinutes);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        className={cn(TRIGGER, className)}
      >
        <Clock3 className="size-4 shrink-0 text-ink-5" />
        <span
          className={cn(
            "flex-1 truncate font-mono tabular-nums",
            !match && "font-sans text-placeholder",
          )}
        >
          {match ? `${String(hour).padStart(2, "0")}:${match[2]}` : placeholder}
        </span>
        {match && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear time"
            onPointerDown={(event) => {
              // pointerdown, not click: the trigger opens on pointerdown, so
              // stopping only the click would clear the value *and* open the
              // popover.
              event.preventDefault();
              event.stopPropagation();
              onChange("");
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-ink-5 transition hover:bg-sunken hover:text-danger-deep"
          >
            <X className="size-3.5" />
          </span>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className={cn(POPUP, "w-56")}>
            {/* Said, not just enforced: a picker that silently offers eight
                hours out of twenty-four looks broken until you know why. */}
            {bounded && windowNote && (
              <p className="mb-2 rounded-lg bg-sunken px-2 py-1.5 text-[10.5px] leading-snug font-medium text-ink-4">
                {windowNote}
              </p>
            )}
            <div className="flex gap-2">
              <NumberColumn
                label="Hour"
                values={hours}
                active={hour}
                onPick={(h) => {
                  // Moving to a boundary hour can strand the minute outside
                  // the window — 15:47 in a shift ending 15:15. Pull it back
                  // to the nearest legal minute of the hour it just landed in.
                  const legal = MINUTES.filter((m) => inWindow(h * 60 + m));
                  const keep =
                    minute !== null && legal.includes(minute)
                      ? minute
                      : (legal[0] ?? 0);
                  set(h, keep);
                }}
              />
              <NumberColumn
                label="Min"
                values={minutes}
                active={minute}
                onPick={(m) => set(hour, m)}
              />
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line-soft pt-2.5">
              <button
                type="button"
                disabled={!nowAllowed}
                title={
                  nowAllowed ? undefined : "The clock is outside this window"
                }
                onClick={() => {
                  const at = new Date();
                  set(at.getHours(), at.getMinutes());
                  setOpen(false);
                }}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-brand transition hover:bg-brand-soft disabled:pointer-events-none disabled:opacity-40"
              >
                Now
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  disabled={!value}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-4 transition hover:bg-sunken hover:text-danger-deep disabled:pointer-events-none disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-[1.06]"
                >
                  Done
                </button>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
