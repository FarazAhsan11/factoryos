import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MaintenanceWorkspace } from "@/components/factory/maintenance/maintenance-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Maintenance · FactoryOS",
};

export default async function MaintenancePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory } = await getFactoryContext(slug);

  // No role gate beyond the nav's: the person who finds a broken machine is
  // whoever was standing next to it. RLS scopes the rows to the tenant, and
  // the insert policy stamps the raiser from the session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-4xl">
      <MaintenanceWorkspace
        factoryId={factory.id}
        userId={user.id}
        units={unitWords(factory)}
      />
    </div>
  );
}
