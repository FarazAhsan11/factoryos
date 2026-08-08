import { createClient } from "@/lib/supabase/client";

/**
 * Actions & escalations. Reads the `actions_expanded` view (migration 0017),
 * where `is_overdue` and `is_escalated` are computed from the clock on every
 * read rather than stored — so an action escalates at 2am whether or not
 * anyone has the app open.
 *
 * Browser-direct under RLS. Nothing here writes `resolved_at`, `resolved_by`
 * or the status history: a trigger stamps those, so the record of who closed
 * something can't be a claim the client made.
 */

export type ActionStatus = "open" | "in_progress" | "resolved";
export type ActionPriority = "critical" | "high" | "medium" | "low";

export const ACTION_CATEGORIES = [
  "Quality",
  "Maintenance",
  "Safety",
  "Process",
  "Manning",
  "Other",
] as const;

export const ACTION_PRIORITIES: {
  value: ActionPriority;
  label: string;
  /** The due window, echoed from `action_window()` so the form can say it. */
  within: string;
}[] = [
  { value: "critical", label: "Critical", within: "2 hours" },
  { value: "high", label: "High", within: "4 hours" },
  { value: "medium", label: "Medium", within: "8 hours" },
  { value: "low", label: "Low", within: "24 hours" },
];

/** Hours each priority gets — mirrors `action_window()` in migration 0017. */
const DUE_HOURS: Record<ActionPriority, number> = {
  critical: 2,
  high: 4,
  medium: 8,
  low: 24,
};

export const STATUS_LABELS: Record<ActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

export interface FactoryAction {
  id: string;
  title: string;
  unit_id: string | null;
  unit_name: string | null;
  category: string;
  priority: ActionPriority;
  status: ActionStatus;
  assigned_to: string | null;
  due_at: string;
  notes: string | null;
  shift_log_entry_id: string | null;
  created_at: string;
  resolved_at: string | null;
  /** Derived in the view, never stored. */
  is_overdue: boolean;
  is_escalated: boolean;
  escalates_at: string;
  note_count: number;
}

export interface ActionNote {
  id: string;
  note: string;
  is_system: boolean;
  created_at: string;
}

const COLUMNS = `
  id, title, unit_id, unit_name, category, priority, status,
  assigned_to, due_at, notes, shift_log_entry_id,
  created_at, resolved_at, is_overdue, is_escalated, escalates_at, note_count
`;

export const actionKeys = {
  all: (factoryId: string) => ["actions", factoryId] as const,
  notes: (actionId: string) => ["action_notes", actionId] as const,
};

/**
 * Every action for the factory, most urgent first.
 *
 * Ordered in Postgres by what actually demands attention: unresolved before
 * resolved, then by due time. An escalated action is by definition the most
 * overdue, so it rises to the top without a separate sort key.
 */
export async function fetchActions(
  factoryId: string
): Promise<FactoryAction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("actions_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("resolved_at", { ascending: true, nullsFirst: true })
    .order("due_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FactoryAction[];
}

export async function fetchActionNotes(
  actionId: string
): Promise<ActionNote[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("action_notes")
    .select("id, note, is_system, created_at")
    .eq("action_id", actionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ActionNote[];
}

export interface NewActionValues {
  title: string;
  unitId: string;
  category: string;
  priority: ActionPriority;
  assignedTo: string;
  /** `datetime-local` value, or "" to derive one from the priority. */
  dueAt: string;
  notes: string;
}

/** Now + the priority's window, as an ISO timestamp. */
export function defaultDueAt(priority: ActionPriority): string {
  return new Date(Date.now() + DUE_HOURS[priority] * 3600_000).toISOString();
}

export async function createAction(
  factoryId: string,
  values: NewActionValues,
  createdBy: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("actions").insert({
    factory_id: factoryId,
    title: values.title.trim(),
    unit_id: values.unitId || null,
    category: values.category,
    priority: values.priority,
    assigned_to: values.assignedTo.trim() || null,
    // A blank due date isn't "no deadline" — an action with no clock can never
    // be overdue and so never escalates, which is the one thing this module
    // exists to prevent. The priority's own window stands in.
    due_at: values.dueAt
      ? new Date(values.dueAt).toISOString()
      : defaultDueAt(values.priority),
    notes: values.notes.trim() || null,
    created_by: createdBy,
  });

  if (error) throw new Error(error.message);
}

export async function updateActionStatus(
  actionId: string,
  status: ActionStatus
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("actions")
    .update({ status })
    .eq("id", actionId);
  if (error) throw new Error(error.message);
}

/** Reassigns an action. Empty string clears it back to unassigned. */
export async function assignAction(
  actionId: string,
  assignedTo: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("actions")
    .update({ assigned_to: assignedTo.trim() || null })
    .eq("id", actionId);
  if (error) throw new Error(error.message);
}

export async function addActionNote(
  factoryId: string,
  actionId: string,
  note: string,
  createdBy: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("action_notes").insert({
    factory_id: factoryId,
    action_id: actionId,
    note: note.trim(),
    created_by: createdBy,
  });
  if (error) throw new Error(error.message);
}

/* ── Display helpers ──────────────────────────────────────────────────── */

/** "8 Aug, 06:46 pm" — the prototype's format, which reads well in a list. */
export function formatDue(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "in 40m" / "3h ago" — the relative half of a due date.
 *
 * The absolute time says when; this says whether that is a problem, which is
 * the thing someone scanning a list actually needs.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const label =
    mins < 60
      ? `${mins}m`
      : mins < 60 * 24
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / (60 * 24))}d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

/** The filter chips across the top of the list. */
export const ACTION_FILTERS = [
  "all",
  "open",
  "in_progress",
  "escalated",
  "resolved",
] as const;

export type ActionFilter = (typeof ACTION_FILTERS)[number];

export const FILTER_LABELS: Record<ActionFilter, string> = {
  all: "All",
  open: "Open",
  in_progress: "In progress",
  escalated: "Escalated",
  resolved: "Resolved",
};

/**
 * Escalated is a *filter*, not a status — it cuts across open and in-progress
 * alike. An action someone started and then left for a shift is exactly the
 * one worth surfacing, so "in progress" does not exempt it.
 */
export function matchesFilter(
  action: FactoryAction,
  filter: ActionFilter
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "escalated":
      return action.is_escalated;
    case "resolved":
      return action.status === "resolved";
    default:
      return action.status === filter;
  }
}
