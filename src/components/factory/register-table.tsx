"use client";

import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * The register table — one frame for Deviations & NCRs, Issues & CAPA and
 * Breakdown maintenance, so the three read as one QMS rather than three
 * screens that happen to list things.
 *
 * A register is read down a column ("which of these is High?", "what is
 * still open on 44637?") and across only once the row is found, which is what
 * opening it is for — so every field on file is a column, the table scrolls
 * sideways with the record's number pinned, and the header row sticks.
 */

export const CELL = "px-3 py-2.5 align-middle text-[13px] whitespace-nowrap";
/** A free-text column: capped and truncated, so one long note can't widen the sheet. */
export const TEXT_CELL =
  "max-w-[18rem] min-w-[10rem] px-3 py-2.5 align-middle text-[13px]";
export const TH =
  "sticky top-0 z-20 bg-sunken-2 px-3 py-2.5 shadow-[inset_0_-1px_0_var(--color-line)]";
/** The pinned column's header — above both the sticky row and the pinned cells. */
export const TH_PINNED = cn(
  TH,
  "left-0 z-30 shadow-[inset_-1px_-1px_0_var(--color-line)]",
);

/** The scroll box and the table. Scrolls both ways inside itself so the header can stick. */
export function RegisterTable({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scrollbar-slim h-full overflow-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="text-left text-[10px] font-bold tracking-[0.07em] whitespace-nowrap text-ink-3 uppercase">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A row that opens its record — by click, Enter or Space. */
export function RegisterRow({
  onOpen,
  dim,
  children,
}: {
  onOpen: () => void;
  /** A finished record, read in quieter ink. */
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <tr
      onClick={onOpen}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group cursor-pointer border-b border-sunken last:border-0 transition",
        "hover:bg-brand-tint focus-visible:bg-brand-tint focus-visible:outline-none",
        dim && "text-ink-4",
      )}
    >
      {children}
    </tr>
  );
}

/**
 * The pinned first cell: the record's number, behind a spine in the colour
 * that ranks the row. It paints its own ground, or the scrolling columns
 * would show through it.
 */
export function PinnedCell({
  spine,
  className,
  children,
}: {
  /** A CSS colour, or a `bg-*` class. */
  spine: string;
  className?: string;
  children: React.ReactNode;
}) {
  const isClass = spine.startsWith("bg-");
  return (
    <td
      className={cn(
        "sticky left-0 z-10 shadow-[inset_-1px_0_0_var(--color-line)]",
        CELL,
        "bg-surface font-mono text-[12.5px] font-semibold text-ink group-hover:bg-brand-tint group-focus-visible:bg-brand-tint",
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn("h-5 w-1 shrink-0 rounded-full", isClass && spine)}
          style={isClass ? undefined : { background: spine }}
        />
        {children}
      </span>
    </td>
  );
}

/**
 * A value, or the dash that means nobody recorded one.
 *
 * Capped and truncated, whole on hover: a short column (owner, category,
 * department) is short until somebody types a sentence into it, and one
 * such value would otherwise stretch its column for every row on the sheet.
 * `fallback` replaces the dash where empty means something ("Unassigned").
 */
export function Val({
  value,
  fallback,
}: {
  value: string | null | undefined;
  fallback?: React.ReactNode;
}) {
  if (!value) return <>{fallback ?? <span className="text-ink-6">—</span>}</>;
  return (
    <span
      className="inline-block max-w-[14rem] truncate align-bottom"
      title={value}
    >
      {value}
    </span>
  );
}

/** Free text in a capped cell, whole on hover. */
export function TextCell({ value }: { value: string | null | undefined }) {
  return (
    <td className={TEXT_CELL} title={value ?? undefined}>
      <span className="block truncate">
        {value || <span className="text-ink-6">—</span>}
      </span>
    </td>
  );
}

export function RegisterEmpty({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Search;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-16 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
        <Icon className="size-6" />
      </span>
      <p className="mt-3 text-sm font-medium text-ink-3">{title}</p>
      <p className="mt-1 text-xs text-ink-5">{body}</p>
    </div>
  );
}

export function RegisterSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="h-10 animate-pulse bg-sunken-2" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-11 animate-pulse bg-sunken/60" />
      ))}
    </div>
  );
}

/** The keyword box beside a register's filter chips. */
export function RegisterSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-[13rem] flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-5" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-[38px] w-full rounded-xl border border-line bg-surface pr-9 pl-9 text-sm text-ink shadow-soft outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-brand/12"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear the filter"
          className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-ink-5 transition hover:bg-sunken-2 hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
