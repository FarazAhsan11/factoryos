"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { ACTION_FLAGS } from "@/app/factory/[slug]/log/schemas";
import type { SetupItem } from "@/lib/factory/setup-queries";
import type { LogTableFilters } from "@/lib/factory/shift-log-table-queries";
import { cn } from "@/lib/utils";

const FILTER_CONTROL =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:font-normal placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

/** Same control, plus our own chevron — see `.select-chevron`. */
const FILTER_SELECT = FILTER_CONTROL + " select-chevron";

const FILTER_LABEL =
  "block text-[10px] font-bold uppercase tracking-[0.07em] text-ink-4";

function Group({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Bottom-aligned: a label that wraps to two lines would otherwise push its
    // control below the rest of the row instead of growing upward.
    <div
      className={cn(
        "flex h-full min-w-0 flex-col justify-end gap-1",
        className,
      )}
    >
      <label
        htmlFor={htmlFor}
        className={cn(FILTER_LABEL, "truncate")}
        title={label}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The data table's filter bar. Every control is committed straight to the
 * parent except the search box, which is debounced — a filter change is one
 * query, but typing would otherwise be one query per keystroke.
 *
 * The room and activity dropdowns are fed by the same React Query caches the
 * Admin panels and the log form use, so arriving here from either is instant.
 */
export function DataTableFilters({
  filters,
  onChange,
  units,
  processes,
  unitWord,
}: {
  filters: LogTableFilters;
  onChange: (next: Partial<LogTableFilters>) => void;
  units: SetupItem[];
  processes: SetupItem[];
  unitWord: string;
}) {
  // The search box is the one control the parent doesn't drive directly:
  // every keystroke would otherwise be a query. It keeps the typed text
  // locally and commits on a 300ms pause.
  //
  // The debounce lives in the change handler rather than an effect, so there
  // is no second render pass mirroring props into state. "Clear filters"
  // resyncs the box by remounting this component — the parent bumps a key.
  const [search, setSearch] = useState(filters.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function handleSearch(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ search: value }), 300);
  }

  return (
    <div className="mb-3.5 grid gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-card sm:grid-cols-2 lg:grid-cols-[repeat(6,minmax(0,1fr))_minmax(200px,2fr)]">
      <Group label="Date from" htmlFor="dt-from">
        <input
          id="dt-from"
          type="date"
          className={FILTER_CONTROL}
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
        />
      </Group>

      <Group label="Date to" htmlFor="dt-to">
        <input
          id="dt-to"
          type="date"
          className={FILTER_CONTROL}
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
        />
      </Group>

      <Group label="Shift" htmlFor="dt-shift">
        <select
          id="dt-shift"
          className={FILTER_SELECT}
          value={filters.shift}
          onChange={(e) =>
            onChange({ shift: e.target.value as LogTableFilters["shift"] })
          }
        >
          <option value="all">All shifts</option>
          <option value="morning">☀ Morning</option>
          <option value="afternoon">🌙 Afternoon</option>
        </select>
      </Group>

      <Group label={`${unitWord} / Unit`} htmlFor="dt-unit">
        <select
          id="dt-unit"
          className={FILTER_SELECT}
          value={filters.unitId}
          onChange={(e) => onChange({ unitId: e.target.value })}
        >
          <option value="all">All {unitWord.toLowerCase()}s</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.active ? "" : " (retired)"}
            </option>
          ))}
        </select>
      </Group>

      <Group label="Activity / Stage" htmlFor="dt-process">
        <select
          id="dt-process"
          className={FILTER_SELECT}
          value={filters.processId}
          onChange={(e) => onChange({ processId: e.target.value })}
        >
          <option value="all">All stages</option>
          {processes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.active ? "" : " (retired)"}
            </option>
          ))}
        </select>
      </Group>

      <Group label="Flag" htmlFor="dt-flag">
        <select
          id="dt-flag"
          className={FILTER_SELECT}
          value={filters.flag}
          onChange={(e) => onChange({ flag: e.target.value })}
        >
          <option value="all">All entries</option>
          <option value="flagged">Flagged only</option>
          {ACTION_FLAGS.map((flag) => (
            <option key={flag} value={flag}>
              {flag}
            </option>
          ))}
        </select>
      </Group>

      {/* Short label, long placeholder: the detail belongs in the box, where
          it doesn't wrap the label onto a second line. */}
      <Group
        label="Search"
        htmlFor="dt-search"
        className="sm:col-span-2 lg:col-span-1"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-5" />
          <input
            id="dt-search"
            type="search"
            className={cn(FILTER_CONTROL, "pl-8")}
            placeholder="Batch, product, operator, comments…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </Group>
    </div>
  );
}
