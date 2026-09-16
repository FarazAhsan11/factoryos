import type { Metadata } from "next";

import { MaintenanceWorkspace } from "@/components/factory/maintenance/maintenance-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Maintenance · FactoryOS",
};

export default async function MaintenancePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, role, viewer } = await getFactoryContext(slug);

  // No role gate beyond the nav's on *reaching* the page: the person who
  // finds a broken machine is whoever was standing next to it. Moving a
  // request through its three sections is a narrower right — supervisor and
  // up — and the role is passed down so the forms can say so rather than
  // letting RLS refuse the write after it was typed.
  return (
    /* Fills the workspace frame from `lg` up rather than growing the page —
       see the note on <main> in FactoryShell. The section chips then stay put
       while the tray under them scrolls, which is the whole point of chips
       that carry counts. */
    <div className="mx-auto w-full max-w-5xl lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <MaintenanceWorkspace
        factoryId={factory.id}
        userId={viewer.id}
        role={role}
        units={unitWords(factory)}
      />
    </div>
  );
}
