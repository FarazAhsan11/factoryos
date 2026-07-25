import { z } from "zod";

/** Admin → Company. Shared by the form and the Server Action. */
export const companySettingsSchema = z.object({
  factoryId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(2, "Enter your company or site name.")
    .max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(280).optional(),
  unitLabel: z
    .string()
    .trim()
    .min(2, "Name your production units.")
    .max(40),
  unitLabelPlural: z
    .string()
    .trim()
    .min(2, "Give the plural form too.")
    .max(40),
  // Registered with { valueAsNumber: true }, so these arrive as numbers.
  oeeTarget: z
    .number({ message: "Enter an OEE target." })
    .int()
    .min(50, "OEE target must be at least 50%.")
    .max(100, "OEE target can't exceed 100%."),
  escalateHours: z
    .number({ message: "Enter an escalation window." })
    .int()
    .min(1, "Escalate after at least 1 hour.")
    .max(48, "Escalation caps at 48 hours."),
});

export type CompanySettingsValues = z.infer<typeof companySettingsSchema>;
