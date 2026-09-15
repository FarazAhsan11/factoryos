import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import type {
  BatchModel,
  WorkOrderMode,
} from "@/app/factory/[slug]/admin/schemas";
import { createClient } from "@/lib/supabase/server";

export type FactoryRole =
  "super_admin" | "admin" | "manager" | "supervisor" | "operator";

export interface FactoryContext {
  factory: {
    id: string;
    name: string;
    slug: string | null;
    description: string | null;
    logo_url: string | null;
    created_at: string;
    unit_label: string | null;
    unit_label_plural: string | null;
    onboarded_at: string | null;
    oee_target: number;
    escalate_hours: number;
    /** How batches are numbered (0042) — decides what New batch offers. */
    batch_model: BatchModel;
    /** Where work orders are recorded (0043) — per batch, per stage, or not. */
    work_order_mode: WorkOrderMode;
  };
  /** The signed-in viewer's role, and whether they may edit factory setup. */
  role: FactoryRole;
  canManage: boolean;
  /** Who is looking — for the account menu in the workspace chrome. */
  viewer: {
    id: string;
    email: string;
    fullName: string | null;
  };
}

/**
 * Loads + authorizes the factory behind /factory/[slug]. Wrapped in `cache()`
 * so the layout and the page share one round-trip per request.
 *
 * Redirects to /login when the viewer has no business here, 404s on an
 * unknown slug — so callers can treat the result as always valid.
 */
export const getFactoryContext = cache(
  async (slug: string): Promise<FactoryContext> => {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    // Independent reads — run them together so navigation costs one round-trip.
    const [{ data: profile }, { data: factory }] = await Promise.all([
      supabase
        .from("profiles")
        .select("role, factory_id, full_name, email")
        .eq("id", user.id)
        .single(),
      supabase
        .from("factories")
        .select(
          "id, name, slug, description, logo_url, created_at, unit_label, unit_label_plural, onboarded_at, oee_target, escalate_hours, batch_model, work_order_mode",
        )
        .eq("slug", slug)
        .single(),
    ]);

    if (!factory) notFound();

    // Super admins can view any factory; everyone else only their own tenant.
    const role = (profile?.role ?? "operator") as FactoryRole;
    const allowed =
      role === "super_admin" || profile?.factory_id === factory.id;
    if (!allowed) redirect("/login");

    return {
      factory: factory as FactoryContext["factory"],
      role,
      canManage:
        role === "super_admin" || role === "admin" || role === "manager",
      viewer: {
        id: user.id,
        email: profile?.email ?? user.email ?? "",
        fullName: profile?.full_name ?? null,
      },
    };
  },
);

/** Singular/plural unit vocabulary with sensible fallbacks. */
export function unitWords(factory: FactoryContext["factory"]) {
  return {
    singular: factory.unit_label ?? "Unit",
    plural: factory.unit_label_plural ?? "Units",
  };
}
