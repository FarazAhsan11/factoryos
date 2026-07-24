import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  FactoryDashboard,
  type FactoryRecord,
} from "@/components/factory/factory-dashboard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Factory dashboard · FactoryOS",
};

export default async function FactoryDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, factory_id")
    .eq("id", user.id)
    .single();

  const { data: factory } = await supabase
    .from("factories")
    .select("id, name, slug, description, logo_url, created_at")
    .eq("slug", slug)
    .single();

  if (!factory) notFound();

  // Super admins can view any factory; everyone else only their own tenant.
  const allowed =
    profile?.role === "super_admin" || profile?.factory_id === factory.id;
  if (!allowed) redirect("/login");

  return <FactoryDashboard factory={factory as FactoryRecord} />;
}
