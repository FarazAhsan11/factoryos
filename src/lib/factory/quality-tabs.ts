import type { DeviationType } from "@/lib/factory/deviation-queries";

/**
 * Quality's screens, chosen in the rail (Quality → …) and read from `?tab=` on
 * the one `/deviations` page. A plain module (no "use client"), like
 * `resource-tabs.ts`, so anything server-side reads the real array.
 *
 * Three of them are the same case register cut by type — a deviation, a
 * non-conformance and a customer complaint share one record and one gate,
 * and differ in what they are about. The fourth is the CAPA register, the
 * plans those cases are worked under.
 *
 * The Dashboard (`?tab=dashboard`) reads all of them: open work today, and
 * trends over a period (`quality-dashboard.ts`).
 */

export type QualityTab = "dashboard" | "deviations" | "ncr" | "complaints" | "capa";

export interface CaseScreen {
  /** The case types this screen lists, and may raise. */
  types: DeviationType[];
  heading: string;
  sub: string;
  /** The raise button. */
  newLabel: string;
  /** The raise dialog's title. */
  newTitle: string;
  /** What this screen calls one of its records, for empty states. */
  noun: string;
}

export const QUALITY_TABS: { value: QualityTab; ready: boolean }[] = [
  { value: "dashboard", ready: true },
  { value: "deviations", ready: true },
  { value: "ncr", ready: true },
  { value: "complaints", ready: true },
  { value: "capa", ready: true },
];

export const CASE_SCREENS: Record<
  Exclude<QualityTab, "dashboard" | "capa">,
  CaseScreen
> = {
  deviations: {
    types: ["planned", "unplanned"],
    heading: "Deviations",
    sub: "Departures from an approved procedure, formula or specification — planned with QA approval, or found after the fact.",
    newLabel: "New deviation",
    newTitle: "New deviation",
    noun: "deviation",
  },
  ncr: {
    types: ["ncr"],
    heading: "Non-conformances",
    sub: "Materials, components or product that fail their specification, and what was decided about them.",
    newLabel: "New non-conformance",
    newTitle: "New non-conformance",
    noun: "non-conformance",
  },
  complaints: {
    types: ["complaint"],
    heading: "Customer complaints",
    sub: "Complaints from customers and the market, from the first report to the response.",
    newLabel: "Log complaint",
    newTitle: "Log a customer complaint",
    noun: "complaint",
  },
};

/** Falls back to Deviations for an unknown, unbuilt or missing `?tab=`. */
export function resolveQualityTab(tab: string | null | undefined): QualityTab {
  return QUALITY_TABS.find((t) => t.value === tab && t.ready)?.value ?? "deviations";
}
