import type { LogEntryValues } from "@/app/factory/[slug]/log/schemas";

/**
 * The grid's typed-but-not-logged lines, kept in the browser.
 *
 * The grid is filled a whole floor at a time and filed with one press of Log
 * all, which puts ten or twenty rooms' worth of typing between saves — and one
 * reload, one tablet asleep too long, one tap on the wrong link would lose the
 * lot. Each line goes in here as it is typed and comes out the moment it is
 * logged (or cleared), so what survives a reload is exactly what is still
 * left to file.
 *
 * Unlike the form's draft (`log-draft.ts`) this **keeps the quantity**. The
 * form's draft is context for the *next* entry, where yesterday's figure would
 * be a wrong one that looks right; a grid line is restored as the very entry
 * it was — its room, its activity, its own two clocks — and a quantity is the
 * part of it that cannot be re-read off anything else. What stops it being
 * filed twice is that a logged line is removed here in the same breath.
 *
 * Local, not a table, for the form draft's reasons: unvalidated, per-device,
 * nobody else's business, and it never leaves the browser.
 */

const VERSION = 1;

/** Per factory and per user — a shared floor tablet changes hands mid-shift. */
function key(factoryId: string, userId: string): string {
  return `factoryos:log-grid-draft:v${VERSION}:${factoryId}:${userId}`;
}

export interface GridDraft {
  /**
   * The working day the lines were typed on. A line's clocks carry no date,
   * and filing stamps today's — so lines from another day are dropped rather
   * than restored to be filed under the wrong one.
   */
  date: string;
  /** The open lines' ids, per room, so a restored line comes back in place. */
  extraRows: Record<string, string[]>;
  /** Each line's values, by row id. */
  rows: Record<string, Partial<LogEntryValues>>;
}

/** The saved lines for `date`, or null if there are none or they are stale. */
export function readGridDraft(
  factoryId: string,
  userId: string,
  date: string,
): GridDraft | null {
  // Every access is guarded: Safari private mode throws on read, storage can
  // be disabled by policy, and a draft is never worth taking the grid down for.
  try {
    const raw = window.localStorage.getItem(key(factoryId, userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as GridDraft;
    if (!parsed || typeof parsed.rows !== "object" || !parsed.rows) {
      return null;
    }
    if (parsed.date !== date) {
      clearGridDraft(factoryId, userId);
      return null;
    }
    const rows: GridDraft["rows"] = {};
    for (const [id, values] of Object.entries(parsed.rows)) {
      rows[id] = sanitise(values);
    }
    return { date, extraRows: parsed.extraRows ?? {}, rows };
  } catch {
    return null;
  }
}

/**
 * Saves the lines, or removes the key when there are none — an empty draft
 * left behind would greet the next reload with nothing to restore.
 */
export function writeGridDraft(
  factoryId: string,
  userId: string,
  draft: GridDraft,
): void {
  if (Object.keys(draft.rows).length === 0) {
    clearGridDraft(factoryId, userId);
    return;
  }
  try {
    const rows: GridDraft["rows"] = {};
    for (const [id, values] of Object.entries(draft.rows)) {
      rows[id] = sanitise(values);
    }
    window.localStorage.setItem(
      key(factoryId, userId),
      JSON.stringify({ ...draft, rows }),
    );
  } catch {
    // Quota, private mode, disabled storage — the grid still works without it.
  }
}

export function clearGridDraft(factoryId: string, userId: string): void {
  try {
    window.localStorage.removeItem(key(factoryId, userId));
  } catch {
    // As above.
  }
}

/**
 * Drops what a round-trip through JSON turns into nonsense, on both sides.
 *
 * An empty number input holds **NaN**, which `JSON.stringify` writes as
 * `null`, and a cleared quantity is `null` already. Restored as-is, either is
 * a value the schema has no branch for, and the line refuses to file over a
 * field nobody typed in. Dropping the key restores it as never filled.
 */
function sanitise(values: Partial<LogEntryValues>): Partial<LogEntryValues> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" && Number.isNaN(v)) continue;
    clean[k] = v;
  }
  return clean as Partial<LogEntryValues>;
}
