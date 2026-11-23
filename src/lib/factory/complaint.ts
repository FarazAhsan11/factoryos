/**
 * A customer complaint as the reference QMS (qms-v12, "v9" and "v11 —
 * Customer complaints") shapes it — the lists its forms offer and the rules
 * that follow. Plain module: the schemas, the queries and the components all
 * read it, and the database checks the same lists (0079).
 */

/** How it reached us — `deviations_received_via_known`. */
export const COMPLAINT_CHANNELS = [
  "Phone",
  "Email",
  "Post",
  "Walk-in",
  "Distributor",
  "Website",
  "Other",
] as const;

/** Who made the complaint — not the brand owner, who comes from the product. */
export const COMPLAINANTS = [
  "Our customer (brand owner)",
  "Distributor or wholesaler",
  "Pharmacy or health professional",
  "Consumer",
  "Other",
] as const;

/** Where the product was sold — decides the regulator. */
export const COUNTRIES = [
  "Australia",
  "New Zealand",
  "United Kingdom",
  "European Union",
  "United States",
  "Other",
] as const;

const REGULATOR: Record<string, string> = {
  Australia: "TGA",
  "New Zealand": "Medsafe",
  "United Kingdom": "MHRA",
  "United States": "FDA",
  "European Union": "national authority",
};

/** "TGA", "Medsafe" … or "regulator" for anywhere else. */
export const regulatorOf = (country: string | null | undefined) =>
  REGULATOR[country ?? ""] ?? "regulator";

export const SPONSORS = [
  { value: "customer", label: "The customer (brand owner)" },
  { value: "us", label: "Us" },
] as const;

export const SAMPLE_STATES = ["Received", "Requested", "Not available"] as const;

/** What the complaint is about — `deviations_nc_category_known` (0079). */
export const COMPLAINT_CATEGORIES = [
  "Cosmetic or appearance defect",
  "Physical defect (broken, leaking, wrong count)",
  "Packaging or labelling error",
  "Foreign matter or contamination",
  "Adverse reaction",
  "Product didn’t work (lack of effect)",
  "Suspected counterfeit or tampering",
  "Other",
] as const;

export const COMPLAINT_RED_FLAGS = [
  "Product mix-up",
  "Incorrect identity or strength",
  "Potential recall",
  "Suspected contamination",
  "Counterfeit or tampering concern",
  "Serious adverse reaction",
] as const;

export const COMPLAINT_SEVERITY = [
  "Cosmetic — no effect on use",
  "Minor defect — still safe and usable",
  "Defect affecting use or quality",
  "Possible health effect",
  "Serious risk to health",
] as const;

export const COMPLAINT_SEVERITY_EXAMPLES = [
  "e.g. scuffed carton, faded print, slight colour variation",
  "e.g. a few broken tablets, stiff cap, dented bottle",
  "e.g. wrong count, leaking bottle, missing leaflet, capsules stuck together",
  "e.g. wrong dose or warning on the label, non-serious reaction, suspected contamination",
  "e.g. wrong product, harmful foreign matter, serious reaction, tampering",
] as const;

export const COMPLAINT_SEVERITY_ROWS = [
  "1–2 · cosmetic / minor, still safe",
  "3–4 · affects use / possible health effect",
  "5 · serious risk to health",
] as const;

export const COMPLAINT_LIKELIHOOD = [
  "First complaint of this kind",
  "Complained about before",
  "Recurring",
] as const;

export const COMPLAINT_LIKELIHOOD_HELP = [
  "No similar complaint in the last 24 months",
  "1–3 similar complaints in the last 24 months",
  "4 or more similar complaints, or 2 within 90 days",
] as const;

export const SERIOUS_HELP =
  "Serious = death, life-threatening, hospital admission, lasting disability, birth defect, or medically important.";

export const STOCK_AFFECTED = ["No", "Yes", "Unknown"] as const;
export const REPORT_TYPES = ["Serious adverse reaction", "Other report"] as const;
export const SCOPES = ["Isolated unit(s)", "Whole batch", "Other batches too"] as const;

/** URPTG terms — the sponsor runs any recall with the TGA. */
export const MARKET_ACTIONS = [
  "No market action",
  "Quarantine stock (pending investigation)",
  "Recall",
  "Product defect correction",
  "Other action (product notification, safety alert)",
] as const;
export const RECALL_CLASSES = ["Class I", "Class II", "Class III"] as const;
export const RECALL_LEVELS = ["Wholesale", "Hospital", "Retail", "Consumer"] as const;
export const RESOLUTIONS = ["None", "Replacement", "Credit or refund"] as const;

/** What a complaint's investigation usually looks at. */
export const COMPLAINT_CHECKS = [
  "Complaint sample",
  "Retention sample",
  "Batch record",
  "Similar complaints",
  "Deviations and NCRs on the batch",
  "Stability data",
  "Raw material or packaging changes",
  "Distribution and storage",
  "Other batches",
] as const;

/** Items the investigation must cover — `deviations_investigation_guard` says the same. */
export function complaintRequiredChecks(d: {
  batch_nos: string[];
  sample: string | null;
}): string[] {
  return [
    ...(d.batch_nos.length > 0 ? ["Batch record", "Retention sample"] : []),
    ...(d.sample === "Received" ? ["Complaint sample"] : []),
  ];
}

/**
 * A regulator report is in question only when something points to it: an
 * adverse reaction, a red flag, suspected counterfeit or tampering, a recall
 * or a product defect correction (`complaint_report_triggered`).
 */
export function reportTriggered(d: {
  adverse_reaction: boolean | null;
  red_flags: readonly string[];
  nc_category: string | null;
  market_action: string | null;
}): boolean {
  return (
    d.adverse_reaction === true ||
    d.red_flags.length > 0 ||
    d.nc_category === "Suspected counterfeit or tampering" ||
    d.market_action === "Recall" ||
    d.market_action === "Product defect correction"
  );
}

/** Why it is asked, in words. */
export function reportTriggerReason(d: {
  adverse_reaction: boolean | null;
  red_flags: readonly string[];
  nc_category: string | null;
}): string {
  if (d.adverse_reaction) return "an adverse reaction was reported";
  if (d.red_flags.length > 0) return "a red flag is ticked";
  if (d.nc_category === "Suspected counterfeit or tampering") {
    return "counterfeit or tampering is suspected";
  }
  return "a market action was recorded";
}

/** Urgent: an adverse reaction or a red flag — the sponsor is told sooner. */
export const urgentComplaint = (d: {
  adverse_reaction: boolean | null;
  red_flags: readonly string[];
}) => d.adverse_reaction === true || d.red_flags.length > 0;
