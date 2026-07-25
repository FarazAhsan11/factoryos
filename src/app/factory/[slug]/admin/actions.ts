"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  companySettingsSchema,
  type CompanySettingsValues,
} from "./schemas";

export type UpdateCompanyResult = { ok: true } | { error: string };

/**
 * Saves Admin → Company. RLS already restricts factory updates to the
 * tenant's admin/manager, but the action re-checks so a rejected write comes
 * back as a readable message rather than a silent no-op.
 */
export async function updateCompanySettings(
  values: CompanySettingsValues
): Promise<UpdateCompanyResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const parsed = companySettingsSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }
  const input = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, factory_id")
    .eq("id", user.id)
    .single();

  const manages =
    profile?.role === "super_admin" ||
    (profile?.factory_id === input.factoryId &&
      (profile?.role === "admin" || profile?.role === "manager"));
  if (!manages) {
    return { error: "You don't have permission to change these settings." };
  }

  const { data: updated, error } = await supabase
    .from("factories")
    .update({
      name: input.name,
      description: input.description || null,
      unit_label: input.unitLabel,
      unit_label_plural: input.unitLabelPlural,
      oee_target: input.oeeTarget,
      escalate_hours: input.escalateHours,
    })
    .eq("id", input.factoryId)
    .select("slug")
    .single();

  if (error) return { error: error.message };

  if (updated?.slug) revalidatePath(`/factory/${updated.slug}`, "layout");
  revalidatePath("/admin");
  return { ok: true };
}
