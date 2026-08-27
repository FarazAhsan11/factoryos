import { z } from "zod";

/**
 * Onboarding wizard contract — shared by the client wizard and the Server
 * Action, so keep this module free of "use server".
 */

/** The unit vocabularies offered in the wizard (value = singular label). */
export const UNIT_PRESETS = [
  { value: "Room", plural: "Rooms", icon: "🏭", hint: "Room 1, Room 9…" },
  { value: "Line", plural: "Lines", icon: "➡️", hint: "Line A, Line 3…" },
  { value: "Machine", plural: "Machines", icon: "⚙️", hint: "Encapsulator 1…" },
  { value: "Area", plural: "Areas", icon: "📍", hint: "Zone A, Bay 2…" },
  {
    value: "Process",
    plural: "Processes",
    icon: "🔄",
    hint: "Mixing, Coating…",
  },
  { value: "Custom", plural: "Custom", icon: "📦", hint: "Name them yourself" },
] as const;

export type UnitPreset = (typeof UNIT_PRESETS)[number]["value"];

const UNIT_VALUES = UNIT_PRESETS.map((u) => u.value) as [
  UnitPreset,
  ...UnitPreset[],
];

export const onboardingSchema = z
  .object({
    factoryId: z.uuid(),
    companyName: z
      .string()
      .trim()
      .min(2, "Enter your company or site name.")
      .max(80, "Keep the name under 80 characters."),
    unitPreset: z.enum(UNIT_VALUES, {
      message: "Pick what you call your production units.",
    }),
    // Only used (and required) when the Custom preset is selected.
    customUnitLabel: z.string().trim().max(40).optional(),
  })
  .refine(
    (v) => v.unitPreset !== "Custom" || (v.customUnitLabel ?? "").length >= 2,
    { path: ["customUnitLabel"], message: "Name your production units." },
  );

export type OnboardingValues = z.infer<typeof onboardingSchema>;

/** Resolves the stored singular/plural unit labels from wizard input. */
export function resolveUnitLabels(values: OnboardingValues) {
  if (values.unitPreset === "Custom") {
    const singular = (values.customUnitLabel ?? "").trim();
    return {
      unit_label: singular,
      unit_label_plural: /s$/i.test(singular) ? singular : `${singular}s`,
    };
  }
  const preset = UNIT_PRESETS.find((u) => u.value === values.unitPreset)!;
  return { unit_label: preset.value, unit_label_plural: preset.plural };
}
