/**
 * A non-conformance as the reference QMS (qms-v12) shapes it — the lists the
 * raise form offers and the questions that follow from "What is
 * non-conforming?". Plain module: the zod schemas, the queries and the
 * components all read it, and the database checks the same lists (0076).
 */

/** Mirrors `deviations_nc_item_known`. */
export const NC_ITEMS = [
  "Raw material",
  "Packaging material",
  "Bulk or intermediate",
  "Finished product",
  "Other",
] as const;
export type NcItem = (typeof NC_ITEMS)[number];

/** Where an NCR was found — no "Customer": a customer report is a complaint. */
export const NCR_DETECTION_POINTS = [
  "Incoming inspection",
  "Warehouse or storage",
  "Dispensing",
  "In-process",
  "QC testing",
  "Stability testing",
  "Supplier told us",
  "Audit",
  "Other",
] as const;
export type NcrDetectionPoint = (typeof NCR_DETECTION_POINTS)[number];

/** Who supplied a material — `supplied_by`. */
export const SUPPLIED_BY = [
  { value: "supplier", label: "Supplier" },
  { value: "customer", label: "Customer (client-supplied)" },
] as const;
export type SuppliedBy = (typeof SUPPLIED_BY)[number]["value"];

/** A raw or packaging material: supplier, lots, quantity — and lot quarantine. */
export const isMaterialItem = (item: string | null | undefined) =>
  item === "Raw material" || item === "Packaging material";

/** Bulk or finished product: its batches and quantity. */
export const isProductItem = (item: string | null | undefined) =>
  item === "Bulk or intermediate" || item === "Finished product";

/**
 * Found after receipt — in dispensing or in-process — so the batch it was
 * found in is known, and asked.
 */
export const batchRequired = (
  item: string | null | undefined,
  detected: string | null | undefined,
) => isMaterialItem(item) && (detected === "Dispensing" || detected === "In-process");

/** "supplier" or "customer" — who is told, and asked for a corrective action. */
export const partyWord = (suppliedBy: string | null | undefined) =>
  suppliedBy === "customer" ? "customer" : "supplier";

/**
 * An NCR raised on the qms-v12 form (0076). One raised before has no
 * `nc_item`, keeps its old fields and still opens in the case dialog.
 */
export const isNcrCase = (d: { type: string; nc_item: string | null }) =>
  d.type === "ncr" && d.nc_item !== null;

/**
 * "CT-902, CT-903" → ["CT-902", "CT-903"]: split on commas and semicolons
 * (a lot number may hold a space), blanks and repeats dropped, first spelling
 * kept — as the database tidies them.
 */
export function parseLots(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;]+/)) {
    const l = raw.trim();
    if (!l || seen.has(l.toLowerCase())) continue;
    seen.add(l.toLowerCase());
    out.push(l);
  }
  return out;
}

/**
 * A deviation, or an NCR raised on the qms-v12 form — the cases that walk the
 * full QMS (assessment, investigation, actions, close-out). The database
 * asks the same with `is_qms_case()`.
 */
export const isQmsCase = (d: { type: string; nc_item?: string | null }) =>
  d.type === "planned" || d.type === "unplanned" || (d.type === "ncr" && d.nc_item != null);

/* ── Assessment (qms-v12) ─────────────────────────────────────────────── */

/** Defect types — for trending and supplier scorecards (`deviations_nc_category_known`). */
export const NCR_CATEGORIES = [
  "Wrong material or identity",
  "Assay or potency out of specification",
  "Physical or dimensional defect",
  "Foreign matter or contamination",
  "Microbiological",
  "Damaged in transit",
  "Labelling or printing error",
  "CoA or documentation error",
  "Short or over delivery",
  "Expired or short shelf life",
  "Storage conditions not met",
  "Other",
] as const;

/** Red flags — escalate to the QA manager (`deviations_red_flags_known`). */
export const NCR_RED_FLAGS = [
  "Wrong material or identity",
  "Suspected contamination",
  "Material already used in released product",
  "Unapproved or unqualified supplier",
  "Suspected falsified material or CoA",
] as const;

/** Severity 1–5, in NCR words — the same scale and table as a deviation's. */
export const NCR_SEVERITY = [
  "Documentation or label error only — the material itself meets specification",
  "Minor defect — usable after sorting or with a concession",
  "Out of specification — caught before use",
  "Already used in production — batches may be affected",
  "Released product affected, or a risk to patient safety",
] as const;

export const NCR_SEVERITY_EXAMPLES = [
  "e.g. CoA typo, smudged supplier label; material tested and meets spec",
  "e.g. a few cosmetic dents above AQL; sorted 100% and the rest used",
  "e.g. assay or moisture out of spec at incoming QC; lot not issued",
  "e.g. wrong-size caps found on the line after use in 2 batches",
  "e.g. wrong material or contamination in released product; recall possible",
] as const;

/** The risk table's rows, as an NCR's table labels them. */
export const NCR_SEVERITY_ROWS = [
  "1–2 · documentation only / usable after sorting",
  "3–4 · out of spec / already used in production",
  "5 · released product or patient safety",
] as const;

/**
 * Found after receipt — any batch named, or found in dispensing, in-process,
 * QC testing or stability testing: the material may already be in batches,
 * so the investigation cannot be skipped.
 */
export const forcedInvestigation = (d: {
  type: string;
  batch_nos: string[];
  detection_point: string | null;
}) =>
  d.type === "ncr" &&
  (d.batch_nos.length > 0 ||
    ["Dispensing", "In-process", "QC testing", "Stability testing"].includes(
      d.detection_point ?? "",
    ));

/* ── Investigation (qms-v12) ──────────────────────────────────────────── */

/** What an NCR's investigation usually looks at. */
export const NCR_CHECKS = [
  "Specification",
  "Certificate of analysis",
  "Incoming inspection record",
  "Retained samples",
  "Supplier history",
  "Other lots from the supplier",
  "Batches made with this lot",
  "Batch record",
  "Previous similar cases",
] as const;

/** The items an NCR's investigation must cover — `deviations_investigation_guard` says the same. */
export function requiredChecks(d: {
  type: string;
  nc_item: string | null;
  batch_nos: string[];
}): string[] {
  if (d.type !== "ncr") return [];
  if (isMaterialItem(d.nc_item)) {
    return [
      "Specification",
      "Certificate of analysis",
      ...(d.batch_nos.length > 0 ? ["Batch record"] : []),
    ];
  }
  if (isProductItem(d.nc_item)) return ["Specification", "Batch record"];
  return ["Specification"];
}

/** Lab error ruled out? — asked when an NCR was found at QC testing. */
export const LAB_CHECK = ["Yes", "In progress", "No"] as const;
export type LabCheck = (typeof LAB_CHECK)[number];

/* ── Actions (qms-v12) ────────────────────────────────────────────────── */

export const NCR_DISPOSITIONS = [
  { value: "use_as_is", label: "Use as is (concession)" },
  { value: "sort", label: "Sort — use good, reject the rest" },
  { value: "rework", label: "Rework" },
  { value: "destroy", label: "Reject – destroy" },
  { value: "return", label: "Return to supplier" },
] as const;
export type NcrDispositionValue = (typeof NCR_DISPOSITIONS)[number]["value"];

export const dispositionLabel = (v: string | null) =>
  NCR_DISPOSITIONS.find((x) => x.value === v)?.label ?? null;

/** A disposition that rejects what it covers (and needs no impact assessment first). */
export const rejectsHolds = (v: string | null) => v === "destroy" || v === "return";

/** "25,000 of 250,000 capsules" → 25000; null when there is no number. */
export function numberIn(text: string | null | undefined): number | null {
  const m = String(text ?? "")
    .replace(/,/g, "")
    .match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
