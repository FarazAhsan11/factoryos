import { createClient } from "@/lib/supabase/client";

/**
 * Shift log → Kaizen. Reads the `kaizen_ideas_expanded` view (migration 0019),
 * which carries the submitter's and reviewer's display names so the feed never
 * has to cross-reference the roster.
 *
 * Browser-direct under RLS, like the rest of the shift log. Note what is
 * **not** here: nothing writes `reviewed_by` or `reviewed_at`. A trigger
 * stamps those from `auth.uid()`, so who reviewed an idea can't be a claim the
 * client made.
 */

export type KaizenStatus =
  | "new"
  | "under_review"
  | "approved"
  | "implemented"
  | "declined";

export type KaizenImpact = "quick_win" | "medium" | "major";

export const KAIZEN_CATEGORIES = [
  "Process",
  "Quality",
  "Safety",
  "Cost",
  "Ergonomics",
  "Waste",
  "Other",
] as const;

/**
 * How much work the idea is, as the person suggesting it sees it. Phrased in
 * time rather than money — an operator knows a change is "a couple of days"
 * long before anyone has costed it, and asking for a number they don't have is
 * how a form stops being filled in.
 */
export const KAIZEN_IMPACTS: {
  value: KaizenImpact;
  label: string;
  tint: string;
  ink: string;
}[] = [
  {
    value: "quick_win",
    label: "Quick win (days)",
    tint: "#ECFDF5",
    ink: "#047857",
  },
  { value: "medium", label: "Medium (weeks)", tint: "#EFF6FF", ink: "#1D4ED8" },
  { value: "major", label: "Major (months)", tint: "#F5F3FF", ink: "#6D28D9" },
];

export const IMPACT_LABELS: Record<KaizenImpact, string> = Object.fromEntries(
  KAIZEN_IMPACTS.map((i) => [i.value, i.label])
) as Record<KaizenImpact, string>;

/**
 * The states an idea moves through, in order, plus the one it can be turned
 * down into. `next` is what a reviewer is offered from here — a single obvious
 * button beats a dropdown of five states, four of which are backwards.
 */
export const KAIZEN_FLOW: {
  status: KaizenStatus;
  label: string;
  tint: string;
  ink: string;
  dot: string;
  /** The status this one advances to, or null at the end of the line. */
  next: KaizenStatus | null;
  nextLabel?: string;
}[] = [
  {
    status: "new",
    label: "New",
    tint: "#F1F5F9",
    ink: "#475569",
    dot: "#94A3B8",
    next: "under_review",
    nextLabel: "Start review",
  },
  {
    status: "under_review",
    label: "Under review",
    tint: "#FEF3C7",
    ink: "#B45309",
    dot: "#F59E0B",
    next: "approved",
    nextLabel: "Approve",
  },
  {
    status: "approved",
    label: "Approved",
    tint: "#DBEAFE",
    ink: "#1D4ED8",
    dot: "#2563EB",
    next: "implemented",
    nextLabel: "Mark implemented",
  },
  {
    status: "implemented",
    label: "Implemented",
    tint: "#DCFCE7",
    ink: "#15803D",
    dot: "#16A34A",
    next: null,
  },
  {
    status: "declined",
    label: "Declined",
    tint: "#FEF2F2",
    ink: "#B91C1C",
    dot: "#DC2626",
    next: null,
  },
];

export const STATUS_META = Object.fromEntries(
  KAIZEN_FLOW.map((s) => [s.status, s])
) as Record<KaizenStatus, (typeof KAIZEN_FLOW)[number]>;

export interface KaizenIdea {
  id: string;
  idea: string;
  category: string;
  impact: KaizenImpact;
  status: KaizenStatus;
  submitted_by: string;
  submitted_by_name: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

const COLUMNS = `
  id, idea, category, impact, status,
  submitted_by, submitted_by_name, created_at,
  reviewed_by, reviewed_by_name, reviewed_at, review_note
`;

export const kaizenKeys = {
  all: (factoryId: string) => ["kaizen_ideas", factoryId] as const,
};

/**
 * Every idea for the factory, newest first.
 *
 * Not scoped to today, unlike the shift-log feed beside it. An entry is a fact
 * about one shift and stops mattering when the shift ends; an idea submitted
 * on Tuesday is still waiting on Friday, and a list that emptied itself
 * overnight would be a suggestion box with a hole in the bottom.
 */
export async function fetchKaizenIdeas(
  factoryId: string
): Promise<KaizenIdea[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("kaizen_ideas_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as KaizenIdea[];
}

export interface NewKaizenValues {
  idea: string;
  category: string;
  impact: KaizenImpact;
}

export async function submitKaizenIdea(
  factoryId: string,
  userId: string,
  values: NewKaizenValues
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("kaizen_ideas").insert({
    factory_id: factoryId,
    idea: values.idea.trim(),
    category: values.category,
    impact: values.impact,
    // Sent because RLS checks it (`submitted_by = auth.uid()`), not because
    // the client gets to choose it — a mismatched id is refused outright.
    submitted_by: userId,
  });

  if (error) throw new Error(error.message);
}

/**
 * Moves an idea along, optionally with a reason.
 *
 * A note is required to decline and optional everywhere else: "no" without a
 * reason is the single most discouraging thing this screen can show the person
 * who submitted it, and the reason is usually one line ("the press is fixed to
 * the floor slab").
 */
export async function reviewKaizenIdea(
  ideaId: string,
  status: KaizenStatus,
  note?: string
): Promise<void> {
  const supabase = createClient();
  const patch: { status: KaizenStatus; review_note?: string | null } = {
    status,
  };
  // Only overwritten when something was typed — advancing an idea shouldn't
  // wipe the reason written at the previous step.
  if (note !== undefined) patch.review_note = note.trim() || null;

  const { error } = await supabase
    .from("kaizen_ideas")
    .update(patch)
    .eq("id", ideaId);
  if (error) throw new Error(error.message);
}

/** Withdraws an idea. RLS allows this to the author while it is still New. */
export async function deleteKaizenIdea(ideaId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("kaizen_ideas")
    .delete()
    .eq("id", ideaId);
  if (error) throw new Error(error.message);
}

/* ── Filtering & display ───────────────────────────────────────────────── */

export const KAIZEN_FILTERS = [
  "all",
  "new",
  "under_review",
  "approved",
  "implemented",
  "declined",
] as const;

export type KaizenFilter = (typeof KAIZEN_FILTERS)[number];

export const FILTER_LABELS: Record<KaizenFilter, string> = {
  all: "All",
  new: "New",
  under_review: "Under review",
  approved: "Approved",
  implemented: "Implemented",
  declined: "Declined",
};

export function matchesKaizenFilter(
  idea: KaizenIdea,
  filter: KaizenFilter
): boolean {
  return filter === "all" || idea.status === filter;
}

/**
 * "just now" / "20m ago" / "3d ago".
 *
 * Relative, not absolute, because the useful question about an idea is how
 * long it has been sitting there. A date tells you when it arrived; this tells
 * you it has been waiting a week.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / (60 * 24));
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}
