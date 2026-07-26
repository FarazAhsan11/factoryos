import { z } from "zod";

/**
 * Shared between the client dialog and the Server Action — keep this module
 * free of "use server" so both sides can import it.
 */
export const deleteFactorySchema = z.object({
  factoryId: z.uuid("A factory must be selected."),
  // The super admin has to retype the factory name to confirm the wipe.
  confirmName: z.string().trim().min(1, "Type the factory name to confirm."),
});

export type DeleteFactoryValues = z.infer<typeof deleteFactorySchema>;

/**
 * Create a factory + its first admin. The logo travels separately as a File on
 * the FormData, so it isn't part of the schema — everything textual is, and
 * the Server Action re-parses the same shape out of the FormData.
 */
export const createFactorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the factory name.")
    .max(80, "Keep the name under 80 characters."),
  description: z
    .string()
    .trim()
    .max(280, "Keep the description under 280 characters.")
    .optional(),
  adminName: z
    .string()
    .trim()
    .min(2, "Enter the admin's full name.")
    .max(80, "Keep the name under 80 characters."),
  adminEmail: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter the admin's email address.")
    .pipe(z.email("Enter a valid email address.")),
});

export type CreateFactoryValues = z.infer<typeof createFactorySchema>;
