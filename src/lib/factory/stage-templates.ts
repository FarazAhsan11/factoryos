import type {
  StageDraftValues,
  StageUnit,
} from "@/app/factory/[slug]/pipeline/schemas";

/**
 * The standard routes a new batch's plan starts from, read off the plant's
 * stage-management sheets: a manufacturing route per bulk unit, and a packing
 * route per bulk unit + pack unit. New batch loads one into the Stages block
 * the moment the units that decide it are picked; everything else on the rows
 * — room, dates, targets — is still the planner's.
 *
 * A route names activities, not process ids: each tenant keeps its own
 * Process stages list, so a stage is matched to it by name (any of `names`,
 * ignoring case, spaces and punctuation). A stage the factory has no activity
 * for still gets its row, with the activity left to pick and the name shown,
 * so the route reads complete and the gap is visible rather than silent.
 */
interface RouteStage {
  /** The sheet's name — what the row says when nothing matches. */
  name: string;
  /** Activity names this stage is known by, best match first. */
  names: string[];
  /** What the row counts in: the bulk, the pack, or the mass being mixed. */
  unit: "bulk" | "pack" | "mix";
}

type Dose = "capsule" | "tablet" | "powder" | "liquid";

const MIXING: RouteStage = { name: "Mixing", names: ["Mixing"], unit: "mix" };
const METAL_DETECTION: RouteStage = {
  name: "Metal Detection",
  names: ["Metal Detection", "Metal Detector"],
  unit: "bulk",
};
const SORTING: RouteStage = { name: "Sorting", names: ["Sorting"], unit: "bulk" };

const MANUFACTURING: Record<Dose, RouteStage[]> = {
  capsule: [
    MIXING,
    { name: "Encapsulation", names: ["Encapsulation"], unit: "bulk" },
    METAL_DETECTION,
    SORTING,
  ],
  tablet: [
    MIXING,
    { name: "Compression", names: ["Compression"], unit: "bulk" },
    METAL_DETECTION,
    SORTING,
    { name: "Coating", names: ["Coating"], unit: "bulk" },
  ],
  powder: [
    {
      name: "Mixing / Blending",
      names: ["Mixing / Blending", "Mixing", "Blending"],
      unit: "mix",
    },
  ],
  liquid: [MIXING],
};

const UNIT_CARTONS: RouteStage = {
  name: "Packing - Unit Cartons",
  names: ["Packing - Unit Cartons", "Unit Cartons", "Unit Carton Packing"],
  unit: "pack",
};
const SHIPPER_BOX: RouteStage = {
  name: "Packing - Shipper Box",
  names: ["Packing - Shipper Box", "Shipper Box", "Shipper Box Packing"],
  unit: "pack",
};

function filling(name: string, short: string): RouteStage {
  return { name, names: [name, short], unit: "pack" };
}

/** Packing routes, keyed `<dose>|<pack unit>`. */
const PACKING: Record<string, RouteStage[]> = {
  "capsule|bottles": [
    filling("Capsule Filling", "Capsule Fill"),
    UNIT_CARTONS,
    SHIPPER_BOX,
  ],
  "tablet|bottles": [
    filling("Tablet Filling", "Tablet Fill"),
    UNIT_CARTONS,
    SHIPPER_BOX,
  ],
  "powder|bottles": [filling("Powder Filling", "Powder Fill"), SHIPPER_BOX],
  "liquid|bottles": [
    filling("Liquid Filling", "Liquid Fill"),
    UNIT_CARTONS,
    SHIPPER_BOX,
  ],
  // "Powder Sachet" and "Liquid Sachet" name the dose in the pack unit itself;
  // the bare "sachets" is what batches raised before that still carry.
  "powder|powder sachets": [
    filling("Powder Sachet Filling", "Powder Sachet Fill"),
    UNIT_CARTONS,
    SHIPPER_BOX,
  ],
  "liquid|liquid sachets": [
    filling("Liquid Sachet Filling", "Liquid Sachet Fill"),
    UNIT_CARTONS,
    SHIPPER_BOX,
  ],
  "powder|sachets": [
    filling("Powder Sachet Filling", "Powder Sachet Fill"),
    UNIT_CARTONS,
    SHIPPER_BOX,
  ],
  "liquid|sachets": [
    filling("Liquid Sachet Filling", "Liquid Sachet Fill"),
    UNIT_CARTONS,
    SHIPPER_BOX,
  ],
};

/** Which dose form a bulk unit is — powder is weighed, liquid measured. */
function doseOf(bulkUnit: string | null | undefined): Dose | null {
  switch (bulkUnit) {
    case "capsules":
      return "capsule";
    case "tablets":
      return "tablet";
    case "kg":
      return "powder";
    case "litres":
      return "liquid";
    default:
      return null;
  }
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function toRows(
  route: RouteStage[],
  processes: { id: string; name: string }[],
  bulkUnit: string | null | undefined,
  packUnit: string | null | undefined,
  dose: Dose,
): StageDraftValues[] {
  const byName = new Map(processes.map((p) => [key(p.name), p.id]));
  const unitOf = (stage: RouteStage): StageUnit => {
    if (stage.unit === "mix") return dose === "liquid" ? "litres" : "kg";
    const unit = stage.unit === "pack" ? packUnit : bulkUnit;
    return (unit || "units") as StageUnit;
  };
  return route.map((stage) => {
    const processId =
      stage.names.map((n) => byName.get(key(n))).find(Boolean) ?? "";
    return {
      processId,
      templateName: processId ? undefined : stage.name,
      unitId: "",
      plannedDate: "",
      estFinishDate: "",
      targetQty: undefined,
      targetUnit: unitOf(stage),
      label: "",
      workOrder: "",
      canRunParallel: false,
    };
  });
}

/** The manufacturing route for a bulk unit — empty where there is none. */
export function manufacturingRoute(
  bulkUnit: string | null | undefined,
  processes: { id: string; name: string }[],
): StageDraftValues[] {
  const dose = doseOf(bulkUnit);
  if (!dose) return [];
  return toRows(MANUFACTURING[dose], processes, bulkUnit, null, dose);
}

/** The packing route for a bulk + pack unit pair — empty where there is none. */
export function packingRoute(
  bulkUnit: string | null | undefined,
  packUnit: string | null | undefined,
  processes: { id: string; name: string }[],
): StageDraftValues[] {
  const dose = doseOf(bulkUnit);
  const route = dose && PACKING[`${dose}|${packUnit}`];
  if (!dose || !route) return [];
  return toRows(route, processes, bulkUnit, packUnit, dose);
}

/**
 * Whether a plan can be swapped for a route without losing anything typed:
 * no row carries a room, a date, a target, a label or a work order. Picking a
 * unit must never wipe a plan someone has started filling in.
 */
export function isUntouchedPlan(stages: StageDraftValues[] | undefined): boolean {
  return (stages ?? []).every(
    (s) =>
      !s.unitId &&
      !s.plannedDate &&
      !s.estFinishDate &&
      !(typeof s.targetQty === "number" && !Number.isNaN(s.targetQty)) &&
      !s.label?.trim() &&
      !s.workOrder?.trim(),
  );
}
