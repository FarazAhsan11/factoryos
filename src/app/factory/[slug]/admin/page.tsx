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
  const { factory, role, canManage } = await getFactoryContext(slug);

  // Admin & Settings is manager-and-up; anyone else goes back to their board.
  if (!canManage) redirect(`/factory/${slug}`);

  const initialTab = resolveAdminTab(tab);

  return (
    /* Fills the workspace frame from `lg` up rather than growing the page —
       see the note on <main> in FactoryShell. The tab strip then stays put
       while a long list of products or people scrolls under it. */
    <div className="mx-auto flex w-full max-w-5xl flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-5 shrink-0">
        <p className="text-[11px] font-bold tracking-[0.09em] text-ink-5 uppercase">
          Setup
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          Admin &amp; configuration
        </h1>
        <p className="mt-1 text-sm text-ink-4">
          The vocabulary and targets every other module reads.
        </p>
      </div>

      <AdminWorkspace
        factory={factory}
        canManage={canManage}
        isAdmin={role === "admin" || role === "super_admin"}
        units={unitWords(factory)}
        initialTab={initialTab}
      />
    </div>
  );
}
