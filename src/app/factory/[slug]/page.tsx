import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  FactoryDashboard,
  type FactoryRecord,
} from "@/components/factory/factory-dashboard";
import { OnboardingWizard } from "@/components/factory/onboarding-wizard";
import { SetupPending } from "@/components/factory/setup-pending";
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
    .select(
      "id, name, slug, description, logo_url, created_at, unit_label, unit_label_plural, onboarded_at"
    )
    .eq("slug", slug)
    .single();

  if (!factory) notFound();

  // Super admins can view any factory; everyone else only their own tenant.
  const allowed =
    profile?.role === "super_admin" || profile?.factory_id === factory.id;
  if (!allowed) redirect("/login");

  const record = factory as FactoryRecord;

  // Until first-run setup is done the dashboard is a backdrop: the factory's
  // admin gets the wizard, everyone else is told to wait for them.
  if (!record.onboarded_at) {
    const canOnboard =
      profile?.role === "admin" || profile?.role === "super_admin";
    return (
      <>
        <FactoryDashboard factory={record} />
        {canOnboard ? (
          <OnboardingWizard factoryId={record.id} factoryName={record.name} />
        ) : (
          <SetupPending factoryName={record.name} />
        )}
      </>
    );
  }

  return <FactoryDashboard factory={record} />;
}
