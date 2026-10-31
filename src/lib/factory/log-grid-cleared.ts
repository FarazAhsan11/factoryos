/**
 * The entries someone has cleared off their grid, kept in the browser.
 *
 * Clear history takes today's filed rows off the sheet for whoever pressed it,
 * so the work already done stops crowding the lines still being typed. It
 * changes that one view and nothing else: the entries are audit-protected and
 * stay where they were, in the activity feed, the shift report and Log history.
 *
 * Which is why this is a list in the browser and not a column or a table — it
 * is a note about one person's sheet, not a fact about an entry. And ids rather
 * than a "cleared at" time: a tablet's clock can be wrong, and an entry filed
 * after the clear has to show whatever that clock says.
 */

const VERSION = 1;

/** Per factory and per user — a shared floor tablet changes hands mid-shift. */
function key(factoryId: string, userId: string): string {
  return `factoryos:log-grid-cleared:v${VERSION}:${factoryId}:${userId}`;
}

interface ClearedEntries {
  /** The working day the ids belong to — the only day the grid ever shows. */
  date: string;
  ids: string[];
}

/** The ids cleared on `date`: none if nothing was, or only on another day. */
export function readClearedEntries(
  factoryId: string,
  userId: string,
  date: string,
): string[] {
  // Every access is guarded: Safari private mode throws on read, storage can
  // be disabled by policy, and a tidier sheet is never worth taking it down for.
  try {
    const raw = window.localStorage.getItem(key(factoryId, userId));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as ClearedEntries;
    if (parsed?.date !== date || !Array.isArray(parsed.ids)) {
      window.localStorage.removeItem(key(factoryId, userId));
      return [];
    }
    return parsed.ids;
  } catch {
    return [];
  }
}

export function writeClearedEntries(
  factoryId: string,
  userId: string,
  cleared: ClearedEntries,
): void {
  try {
    window.localStorage.setItem(key(factoryId, userId), JSON.stringify(cleared));
  } catch {
    // Quota, private mode, disabled storage — the rows just return on a reload.
  }
}
