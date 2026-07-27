"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import type { RunningShift } from "@/lib/factory/shift-time-queries";
import {
  minutesOfDay,
  shiftLengthMinutes,
  type ShiftClock,
} from "@/lib/factory/shift-time-queries";

/**
 * The shift context strip above the time fields: which shift the entry is
 * being written against, its window, and how far into it we are. The elapsed
 * figure ticks once a minute — often enough to stay honest, cheap enough not
 * to matter.
 */
export function ShiftBanner({
  shift,
  clock,
  onSwitch,
}: {
  shift: RunningShift;
  clock: ShiftClock;
  /** Lets a late entry be logged against the shift it actually belongs to. */
  onSwitch: (shift: RunningShift) => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const start = minutesOfDay(clock.startTime);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const length = shiftLengthMinutes(clock);
  const elapsed = start === null ? null : (nowMins - start + 24 * 60) % (24 * 60);

  const status = (() => {
    if (elapsed === null) return "—";
    if (elapsed > length) return "Shift ended";
    const h = Math.floor(elapsed / 60);
    const m = elapsed % 60;
    return `${h}h ${m}m elapsed`;
  })();

  const other: RunningShift = shift === "morning" ? "afternoon" : "morning";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 py-2.5 text-xs">
      <span className="flex items-center gap-1.5 text-[#64748B]">
        {shift === "morning" ? (
          <Sun className="size-3.5 text-[#F59E0B]" />
        ) : (
          <Moon className="size-3.5 text-[#6366F1]" />
        )}
        <span className="font-medium capitalize text-[#0F1B34]">{shift}</span>
        shift: {clock.startTime} → {clock.endTime}
      </span>
      <span className="flex items-center gap-3">
        <span className="font-mono font-semibold text-[#2563EB]">{status}</span>
        <button
          type="button"
          onClick={() => onSwitch(other)}
          className="rounded-md px-2 py-0.5 font-medium text-[#64748B] transition hover:bg-[#F1F5F9] hover:text-[#0F1B34]"
        >
          Log as {other}
        </button>
      </span>
    </div>
  );
}
