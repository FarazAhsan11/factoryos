import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminWorkspace } from "@/components/factory/admin/admin-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Configuration · FactoryOS",
};

export default async function FactoryAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, canManage } = await getFactoryContext(slug);

  // Admin & Settings is manager-and-up; anyone else goes back to their board.
  if (!canManage) redirect(`/factory/${slug}`);

  // No heading: the rail names the section (Configuration) and the open
  // panel's own header names the screen — a page title over both was a row
  // spent saying it a third time. The section is read from `?tab=` by the
  // workspace, so the rail can switch it without a round trip.
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col lg:min-h-0 lg:flex-1">
      <AdminWorkspace
        factory={factory}
        canManage={canManage}
        units={unitWords(factory)}
      />
    </div>
  );
}
