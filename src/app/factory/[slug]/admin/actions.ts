"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  companySettingsSchema,
  shiftTimesSchema,
  type CompanySettingsValues,
  type ShiftTimesValues,
} from "./schemas";

export type UpdateCompanyResult = { ok: true } | { error: string };
export type UpdateShiftTimesResult = { ok: true } | { error: string };

/** Admin → Company and → Shift times are both manager-and-up. */
async function requireManages(factoryId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not signed in.";

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, factory_id")
    .eq("id", user.id)
    .single();

  const manages =
    profile?.role === "super_admin" ||
    (profile?.factory_id === factoryId &&
      (profile?.role === "admin" || profile?.role === "manager"));

  return manages ? null : "You don't have permission to change these settings.";
}

/**
 * Saves Admin → Company. RLS already restricts factory updates to the
 * tenant's admin/manager, but the action re-checks so a rejected write comes
 * back as a readable message rather than a silent no-op.
 */
export async function updateCompanySettings(
  values: CompanySettingsValues
): Promise<UpdateCompanyResult> {
  const parsed = companySettingsSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }
  const input = parsed.data;

  const denied = await requireManages(input.factoryId);
  if (denied) return { error: denied };

  const supabase = await createClient();
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

/**
 * Saves Admin → Shift times. Both shifts are written in one upsert keyed on
 * (factory_id, slot), so a factory can never end up with a morning clock saved
 * and an afternoon one lost.
 */
export async function updateShiftTimes(
  values: ShiftTimesValues
): Promise<UpdateShiftTimesResult> {
  const parsed = shiftTimesSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid shift times." };
  }
  const { factoryId, morning, afternoon } = parsed.data;

  const denied = await requireManages(factoryId);
  if (denied) return { error: denied };

  const supabase = await createClient();
  const row = (slot: "morning" | "afternoon", shift: typeof morning) => ({
    factory_id: factoryId,
    slot,
    start_time: shift.startTime,
    end_time: shift.endTime,
    // An empty break start means "no such break"; store it as null so the
    // shift log can tell that apart from a break at midnight.
    break1_start: shift.break1Start || null,
    break1_minutes: shift.break1Start ? shift.break1Minutes : 0,
    break2_start: shift.break2Start || null,
    break2_minutes: shift.break2Start ? shift.break2Minutes : 0,
    supervisor_name: shift.supervisorName?.trim() || null,
    updated_at: new Date().toISOString(),
  });

  const { error } = await supabase
    .from("factory_shift_times")
    .upsert([row("morning", morning), row("afternoon", afternoon)], {
      onConflict: "factory_id,slot",
    });

  if (error) return { error: error.message };
  return { ok: true };
}
