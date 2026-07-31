import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DataTableWorkspace } from "@/components/factory/data/data-table-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Shift log data · FactoryOS",
};

export default async function ShiftLogDataPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // No role gate, matching the shift log itself: everyone who logs entries can
  // read back what their factory logged. RLS scopes the rows to the tenant.
  const { factory, canManage } = await getFactoryContext(slug);

  // Needed to decide which rows offer an Amend button — the update policy
  // allows the entry's author or a manager, and the UI mirrors that.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-[1600px]">
      <DataTableWorkspace
        factoryId={factory.id}
        factoryName={factory.name}
        units={unitWords(factory)}
        userId={user.id}
        canManage={canManage}
      />
    </div>
  );
}
