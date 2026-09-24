"use client";

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The app's dropdown.
 *
 * A native `<select>` is the browser's widget, not ours: Chrome on Windows
 * draws a grey system list in its own font, Safari draws a wheel, and none of
 * them can be given a search box. That is survivable for "Morning /
 * Afternoon" and unusable for the batch picker, where the catalogue runs to
 * hundreds of rows and the only way to reach 46244 is to scroll a system list
 * with no way to type at it.
 *
 * So this is the same contract as the control it replaces — a string in, a
 * string out, `""` for empty — over Base UI's combobox, with the search input
 * inside the popup. Every dropdown in the workspace is this component, which
 * is what makes them one control rather than fifteen.
 *
 * The search box appears on its own once a list is long enough to need it
 * (see `searchable`): a three-option list under a search field is chrome
 * pretending to be a feature.
 */

export interface SelectOption {
  /** `""` is legal, and means the field is empty. */
  value: string;
  label: string;
  /** Dimmed trailing text: a code, a target, "(retired)". */
  meta?: string;
  /** A second line under the label, where an option needs a sentence. */
  hint?: string;
  /**
   * Survives the search filter whatever the query. For an escape hatch — the
   * operator picker's "Not on the list…" — which is precisely what someone
   * reaches for *after* typing a name the list doesn't have, and which a
   * plain filter would take away at that exact moment.
   */
  pinned?: boolean;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

/** Long enough that hunting for an option beats reading the whole list. */
const SEARCH_THRESHOLD = 7;

const TRIGGER =
  "flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-left text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition hover:border-line-strong focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/12 data-popup-open:border-brand data-popup-open:ring-4 data-popup-open:ring-brand/12 aria-invalid:border-danger aria-invalid:ring-4 aria-invalid:ring-danger/12 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70";

const POPUP =
  "z-50 flex max-h-[min(22rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) min-w-52 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgb(20_22_43/0.45)] ring-1 ring-ink/5 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

const ITEM =
  "grid cursor-default grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-brand-soft data-highlighted:text-brand-deep data-selected:font-semibold";

export function SelectField({
  id,
  value,
  onChange,
  onBlur,
  options,
  groups,
  placeholder = "Select…",
  clearable = false,
  clearLabel,
  searchable,
  searchPlaceholder = "Search…",
  emptyMessage = "Nothing matches that.",
  disabled,
  icon: Icon,
  className,
  ariaLabel,
  ariaInvalid,
}: {
  id?: string;
  /** The chosen option's value, or `""`. */
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  /** A flat list. Pass this or `groups`, not both. */
  options?: SelectOption[];
  /** Options under headings — the shift log's stages by category. */
  groups?: SelectOptionGroup[];
  /** Shown on the trigger while nothing is chosen. */
  placeholder?: string;
  /** Adds a first item that puts the field back to `""`. */
  clearable?: boolean;
  /** What that item is called. Defaults to the placeholder. */
  clearLabel?: string;
  /** Defaults to on once the list passes `SEARCH_THRESHOLD` options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  /** Drawn at the left of the trigger — a room, a machine, a person. */
  icon?: LucideIcon;
  className?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
}) {
  /* An explicit "back to empty" row rather than an X on the trigger: it is
     what the native control did, it needs no new affordance, and half of these
     fields mean something when empty ("No parent — external bulk") rather than
     merely being unfilled. */
  const clearKey = clearable ? (clearLabel ?? placeholder) : null;

  /* Base UI wants either a flat list or a list of groups, never a mix — so in
     a grouped field the clear row gets a nameless group of one to sit in. */
  const items = useMemo(() => {
    const clearOption = clearKey === null ? null : { value: "", label: clearKey };
    if (groups) {
      const base = groups.map((g) => ({ label: g.label, items: g.options }));
      return clearOption ? [{ label: "", items: [clearOption] }, ...base] : base;
    }
    const base = options ?? [];
    return clearOption ? [clearOption, ...base] : base;
  }, [groups, options, clearKey]);

  const flat = useMemo(
    () => (groups ? groups.flatMap((g) => g.options) : (options ?? [])),
    [groups, options],
  );

  const selected = useMemo(() => {
    if (clearKey !== null && value === "") return { value: "", label: clearKey };
    return flat.find((o) => o.value === value) ?? null;
  }, [flat, value, clearKey]);

  const showSearch = searchable ?? flat.length >= SEARCH_THRESHOLD;

  return (
    <Combobox.Root<SelectOption>
      items={items}
      value={selected}
      // The input is only ever the search box, never a mirror of the choice.
      // Left unset, Base UI seeds the query with the label chosen at mount and
      // clears it on close only if an input is rendered — which a short list
      // never has. So after picking a different option, reopening filtered
      // every row against the old label and showed "Nothing matches that".
      defaultInputValue=""
      disabled={disabled}
      onValueChange={(next) => onChange(next?.value ?? "")}
      // The option objects are rebuilt on every parent render, so identity
      // comparison would drop the selection the moment anything upstream
      // re-rendered.
      isItemEqualToValue={(a, b) => a?.value === b?.value}
      // Matches the dimmed trailing text too, so a product code or a stage
      // target is searchable even when the label doesn't contain it. The clear
      // row drops out as soon as there is a query — it is a way back to empty,
      // not a search result.
      filter={(item: SelectOption, query: string) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        if (item.pinned) return true;
        if (item.value === "" && clearKey !== null) return false;
        return [item.label, item.meta, item.hint].some(
          (text) => text && text.toLowerCase().includes(q),
        );
      }}
    >
      <Combobox.Trigger
        id={id}
        onBlur={onBlur}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        className={cn(TRIGGER, className)}
      >
        {Icon && <Icon className="size-4 shrink-0 text-ink-5" />}
        <span
          className={cn(
            "flex-1 truncate",
            selected === null && "text-placeholder",
          )}
        >
          <Combobox.Value placeholder={placeholder}>
            {(current: SelectOption | null) =>
              current ? (
                <>
                  {current.label}
                  {current.meta && (
                    <span className="ml-1.5 text-ink-5">{current.meta}</span>
                  )}
                </>
              ) : (
                placeholder
              )
            }
          </Combobox.Value>
        </span>
        <Combobox.Icon className="shrink-0 text-ink-5">
          <ChevronsUpDown className="size-4" />
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} align="start" className="z-50">
          <Combobox.Popup className={POPUP} aria-label={ariaLabel}>
            {showSearch && (
              <div className="relative shrink-0 border-b border-line-soft">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-5" />
                <Combobox.Input
                  placeholder={searchPlaceholder}
                  className="h-10 w-full bg-transparent pr-3 pl-9 text-sm text-ink outline-none placeholder:text-placeholder"
                />
              </div>
            )}

            <Combobox.Empty className="px-3.5 py-6 text-center text-[13px] text-ink-5 empty:hidden">
              {emptyMessage}
            </Combobox.Empty>

            <Combobox.List className="scrollbar-slim min-h-0 flex-1 scroll-py-1 overflow-y-auto p-1 empty:p-0">
              {groups
                ? (group: { label: string; items: SelectOption[] }) => (
                    <Combobox.Group
                      // Headings are not unique enough on their own: a field
                      // can have more than one nameless group (the clear row
                      // and, in the operator picker, "Not on the list").
                      key={`${group.label}|${group.items[0]?.value ?? ""}`}
                      items={group.items}
                      className="block pb-1 last:pb-0"
                    >
                      {/* A nameless group holds a row that is not part of any
                          section — it gets no heading. */}
                      {group.label && (
                        <Combobox.GroupLabel className="px-2.5 pt-2 pb-1 text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
                          {group.label}
                        </Combobox.GroupLabel>
                      )}
                      <Combobox.Collection>
                        {(item: SelectOption) => (
                          <Row key={item.value} item={item} />
                        )}
                      </Combobox.Collection>
                    </Combobox.Group>
                  )
                : (item: SelectOption) => <Row key={item.value} item={item} />}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** One option: tick, label (+ hint), trailing meta. */
function Row({ item }: { item: SelectOption }) {
  return (
    <Combobox.Item value={item} disabled={item.disabled} className={ITEM}>
      <Combobox.ItemIndicator className="col-start-1 flex items-center justify-center text-brand">
        <Check className="size-3.5" />
      </Combobox.ItemIndicator>
      <span className="col-start-2 min-w-0">
        <span className="block truncate">{item.label}</span>
        {item.hint && (
          <span className="mt-0.5 block truncate text-[11px] font-normal text-ink-5">
            {item.hint}
          </span>
        )}
      </span>
      {item.meta && (
        // Capped so an over-long meta truncates itself instead of squeezing the
        // label to nothing — sentences belong in `hint`.
        <span className="col-start-3 max-w-40 truncate font-mono text-[11px] font-normal text-ink-5">
          {item.meta}
        </span>
      )}
    </Combobox.Item>
  );
}
