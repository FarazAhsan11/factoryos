import type { LogEntryValues } from "@/app/factory/[slug]/log/schemas";

/**
 * The half-filled shift-log entry, kept in the browser.
 *
 * An entry is eleven fields deep and is filled on a factory floor, where the
 * tab gets closed, the tablet sleeps, and someone navigates to the Pipeline to
 * check a batch number mid-form. Losing the lot to any of those is what makes
 * an operator file a thinner entry next time — so the draft survives the page,
 * and only a successful submit clears it.
 *
 * With one exception: the quantity produced is never written here at all. See
 * `NEVER_STORED`.
 *
 * Local, not a table: it is unvalidated, half-typed, per-device text that no
 * other user has any business reading, and round-tripping every keystroke
 * through Postgres would buy nothing. It never leaves the browser.
 */

const VERSION = 1;

/**
 * Fields the draft never keeps, however much else it keeps.
 *
 * `qty` — the quantity this entry produced — is the one number on the form
 * that belongs to a single hour and to nothing else. Everything else the draft
 * restores is context that is still true after a reload: the room, the batch,
 * the machine, the crew. A quantity is not: it was typed against one activity
 * in one hour, and offering it again on the next form is a wrong entry that
 * looks exactly like a right one — filed, audit-protected, and correctable
 * only by amendment.
 *
 * Stripped in `sanitise`, which runs on write *and* on read, so a quantity
 * already sitting in someone's browser is dropped the next time the form
 * opens rather than waiting out its twelve hours.
 */
const NEVER_STORED = new Set<string>(["qty"]);

/**
 * Per factory *and* per user, because a shared floor tablet is signed in and
 * out of by different operators through a shift, and one person's draft must
 * not open pre-filled under the next person's name.
 */
function key(factoryId: string, userId: string): string {
  return `factoryos:log-draft:v${VERSION}:${factoryId}:${userId}`;
}

interface Stored {
  savedAt: number;
  values: Partial<LogEntryValues>;
}

/**
 * A draft outlives the tab, but not the shift. Times are the reason: an entry
 * carries a start and end clock with no date on them, so a draft restored two
 * days later would silently offer yesterday's 06:45 as though it were today's.
 * Twelve hours is longer than any one shift and shorter than the gap to the
 * next.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Reads the saved draft, or null if there is none, it is stale, or unreadable. */
export function readLogDraft(
  factoryId: string,
  userId: string,
): Partial<LogEntryValues> | null {
  // Every access is guarded: Safari private mode throws on read, storage can
  // be disabled by policy, and a draft is never worth taking the form down for.
  try {
    const raw = window.localStorage.getItem(key(factoryId, userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || typeof parsed.savedAt !== "number" || !parsed.values) {
      return null;
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearLogDraft(factoryId, userId);
      return null;
    }
    return sanitise(parsed.values);
  } catch {
    return null;
  }
}

/**
 * Strips the fields a draft must not carry, and the nulls a round-trip
 * through JSON leaves behind.
 *
 * The first is `NEVER_STORED` — see above.
 *
 * An empty number input registered with `valueAsNumber` holds **NaN**, and
 * `JSON.stringify(NaN)` writes `null`. Restored as-is, every unfilled quantity
 * comes back as a null the schema has no branch for, and the form refuses to
 * submit — pointing at a field the current shape may not even render. Dropping
 * the key is the honest restore: it was never recorded.
 *
 * Applied on **both** sides. On write so nothing new is stored this way, and
 * on read so a draft already sitting in someone's browser heals itself rather
 * than waiting out its twelve hours.
 */
function sanitise(
  values: Partial<LogEntryValues>,
): Partial<LogEntryValues> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (NEVER_STORED.has(k)) continue;
    if (v === null) continue;
    if (typeof v === "number" && Number.isNaN(v)) continue;
    clean[k] = v;
  }
  return clean as Partial<LogEntryValues>;
}

export function writeLogDraft(
  factoryId: string,
  userId: string,
  values: Partial<LogEntryValues>,
): void {
  try {
    const payload: Stored = { savedAt: Date.now(), values: sanitise(values) };
    window.localStorage.setItem(key(factoryId, userId), JSON.stringify(payload));
  } catch {
    // Quota, private mode, disabled storage — the form still works without it.
  }
}

export function clearLogDraft(factoryId: string, userId: string): void {
  try {
    window.localStorage.removeItem(key(factoryId, userId));
  } catch {
    // As above.
  }
}

/**
 * Is there anything in here worth restoring?
 *
 * The form writes on every keystroke, so a draft holding nothing but the
 * defaults (a factory id, "morning", an empty operator row) is the normal
 * resting state and must not announce itself as recovered work.
 */
export function draftHasContent(values: Partial<LogEntryValues>): boolean {
  return Boolean(
    values.unitId ||
      values.processId ||
      values.startTime ||
      values.endTime ||
      values.batchNo ||
      values.batchStageId ||
      values.equipmentNo ||
      values.comment ||
      // `qty` is deliberately absent: it is never stored (see NEVER_STORED),
      // so asking after it here could only ever read a stale draft written
      // before that rule existed.
      values.operators?.some((o) => o?.name),
  );
}
