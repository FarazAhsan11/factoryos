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
