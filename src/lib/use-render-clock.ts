"use client";

import { useSyncExternalStore } from "react";

/**
 * One shared 30-second tick for every clock reader on the page. It only runs
 * while at least one component is reading, and each reader re-renders on a
 * tick only when what it reads has actually changed.
 */
const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((l) => l()), TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * Reads something the wall clock decides — today's date, the minute, "3h ago"
 * — fresh on every render, and again every 30 seconds.
 *
 * Exists because of the React Compiler. The compiler takes render to be pure,
 * so a plain `const today = todayKey()` in a component is cached the first
 * time and handed back on every render after: a form left open past midnight
 * keeps refusing today's date, and a clock picker keeps its "Now" button in
 * whatever state it had when it mounted. Called through a hook, the read runs
 * on every render exactly as it did before — hooks are never memoized away.
 *
 * The tick covers the other half. Before the compiler, a "Down 3h 20m" label
 * was refreshed whenever anything above it re-rendered; the compiler now skips
 * rows whose data didn't change, so without the tick such a label would sit
 * still until its row's data did.
 *
 * `read` must return a primitive (a string, a number, a boolean, null): React
 * compares successive reads with `Object.is`, and a fresh `Date` object every
 * call would read as a change every time.
 */
export function useRenderClock<T extends string | number | boolean | null>(
  read: () => T,
): T {
  return useSyncExternalStore(subscribe, read, read);
}

/** Minutes since local midnight, right now — 14:05 is 845. */
export function minutesNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Now, in epoch milliseconds, to the second — for "in 3h" / "20m ago" labels.
 * Floored so two reads in the same render agree, which `useSyncExternalStore`
 * requires; a second is far finer than any label it feeds.
 */
export function secondNow(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}
