import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminWorkspace } from "@/components/factory/admin/admin-workspace";
import { resolveAdminTab } from "@/lib/factory/admin-tabs";
import { getFactoryContext, unitWords } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Admin & Settings · FactoryOS",
};

export default async function FactoryAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const { factory, canManage } = await getFactoryContext(slug);

  // Admin & Settings is manager-and-up; anyone else goes back to their board.
  if (!canManage) redirect(`/factory/${slug}`);

  const initialTab = resolveAdminTab(tab);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
          Setup
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0F1B34]">
          Admin &amp; configuration
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">
          The vocabulary and targets every other module reads.
        </p>
      </div>

      <AdminWorkspace
        factory={factory}
        canManage={canManage}
        units={unitWords(factory)}
        initialTab={initialTab}
      />
    </div>
  );
}
