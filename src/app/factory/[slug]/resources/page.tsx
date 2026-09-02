import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResourcesWorkspace } from "@/components/factory/resources/resources-workspace";
import { getFactoryContext } from "@/lib/factory/context";
import { resolveResourceTab } from "@/lib/factory/resource-tabs";

export const metadata: Metadata = {
  title: "Resources · FactoryOS",
};

export default async function FactoryResourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const { role, factory, canManage } = await getFactoryContext(slug);

  // Same gate the three panels had under Admin — manager and up.
  if (!canManage) redirect(`/factory/${slug}`);

  const initialTab = resolveResourceTab(tab);

  return (
    /* Fills the workspace frame from `lg` up rather than growing the page —
       see the note on <main> in FactoryShell. The tab strip then stays put
       while a long list of products or people scrolls under it. */
    <div className="mx-auto flex w-full max-w-5xl flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-5 shrink-0">
        <p className="text-[11px] font-bold tracking-[0.09em] text-ink-5 uppercase">
          Production
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          Resources
        </h1>
        <p className="mt-1 text-sm text-ink-4">
          The machines, the people and the catalogue every other module names.
        </p>
      </div>

      <ResourcesWorkspace
        factoryId={factory.id}
        canManage={canManage}
        isAdmin={role === "admin" || role === "super_admin"}
        initialTab={initialTab}
      />
    </div>
  );
}
