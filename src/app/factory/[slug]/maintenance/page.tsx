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
  const { factory, role } = await getFactoryContext(slug);

  // No role gate beyond the nav's on *reaching* the page: the person who
  // finds a broken machine is whoever was standing next to it. Moving a
  // request through its three sections is a narrower right — supervisor and
  // up — and the role is passed down so the forms can say so rather than
  // letting RLS refuse the write after it was typed.
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
        role={role}
        units={unitWords(factory)}
      />
    </div>
  );
}
