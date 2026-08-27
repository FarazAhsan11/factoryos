"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  onboardingSchema,
  resolveUnitLabels,
  type OnboardingValues,
} from "./schemas";

export type CompleteOnboardingResult = { ok: true } | { error: string };

/**
 * Finishes a factory's first-run setup: confirms the site name, records what
 * the tenant calls its production units, and stamps `onboarded_at` so the
 * wizard stops appearing on the dashboard.
 *
 * Only the factory's own admin (or a platform super admin) may run it.
 */
export async function completeOnboarding(
  values: OnboardingValues,
): Promise<CompleteOnboardingResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // ── Validate on the server; client-side zod is UX only ───────────────────
  const parsed = onboardingSchema.safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid setup input." };
  }
  const input = parsed.data;

  // ── Authorize against the factory being onboarded ────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, factory_id")
    .eq("id", user.id)
    .single();

  const isOwnAdmin =
    profile?.role === "admin" && profile.factory_id === input.factoryId;
  if (!isOwnAdmin && profile?.role !== "super_admin") {
    return { error: "Only this factory's admin can complete onboarding." };
  }

  const { data: factory, error: loadError } = await supabase
    .from("factories")
    .select("id, slug, onboarded_at")
    .eq("id", input.factoryId)
    .maybeSingle();
  if (loadError) return { error: loadError.message };
  if (!factory) return { error: "That factory no longer exists." };
  if (factory.onboarded_at) return { error: "This factory is already set up." };

  // ── Persist the setup ────────────────────────────────────────────────────
  const { unit_label, unit_label_plural } = resolveUnitLabels(input);
  const { error: updateError } = await supabase
    .from("factories")
    .update({
      name: input.companyName,
      unit_label,
      unit_label_plural,
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", factory.id);
  if (updateError) return { error: updateError.message };

  if (factory.slug) revalidatePath(`/factory/${factory.slug}`);
  revalidatePath("/admin");
  return { ok: true };
}
