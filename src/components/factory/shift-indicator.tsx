"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";

import {
  fetchShiftTimes,
  minutesOfDay,
  resolveCurrentShift,
  shiftLengthMinutes,
  shiftTimeKeys,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/**
 * Which shift is running right now, in the workspace top bar. It's ambient
 * context for every route under /factory/[slug], not a property of whatever
 * form happens to be open — showing it inside the entry form invited the
 * reading that it was something you set per entry.
 *
 * The clock is the **browser's** local time, deliberately. A factory floor
 * reads the wall, and the server may be in another timezone entirely; a shift
 * that starts at 06:45 means 06:45 where the machines are.
 */
export function ShiftIndicator({
  factoryId,
  className,
}: {
  factoryId: string;
  className?: string;
}) {
  const { data: shiftTimes } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });

  // Ticks once a minute: often enough to stay honest, cheap enough not to
  // matter. Reading the clock in the initializer is safe here even though it
  // differs server-to-client — nothing renders until `shiftTimes` arrives, and
  // that query has no data on either the server render or the hydrating one,
  // so both produce `null` and there is no markup to mismatch.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!shiftTimes) return null;

  const shift: RunningShift = resolveCurrentShift(shiftTimes, now);
  const clock = shiftTimes[shift];
  const start = minutesOfDay(clock.startTime);
  const length = shiftLengthMinutes(clock);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const elapsed =
    start === null ? null : (nowMins - start + 24 * 60) % (24 * 60);

  // Outside the window entirely — `resolveCurrentShift` names the shift that's
  // *next*, so saying "0h 0m elapsed" would misread as "just started".
  const running = elapsed !== null && elapsed <= length;
  const status = !running
    ? "Off shift"
    : `${Math.floor(elapsed / 60)}h ${elapsed % 60}m elapsed`;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-[#E6EAF1] bg-[#FBFCFE] px-3 py-1 text-xs",
        className
      )}
    >
      {shift === "morning" ? (
        <Sun className="size-3.5 shrink-0 text-[#F59E0B]" />
      ) : (
        <Moon className="size-3.5 shrink-0 text-[#6366F1]" />
      )}
      <span className="text-[#64748B]">
        <span className="font-medium capitalize text-[#0F1B34]">{shift}</span>{" "}
        {clock.startTime} → {clock.endTime}
      </span>
      <span
        className={cn(
          "font-mono font-semibold",
          running ? "text-[#2563EB]" : "text-[#94A3B8]"
        )}
      >
        {status}
      </span>
    </div>
  );
}
