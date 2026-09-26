import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResourcesWorkspace } from "@/components/factory/resources/resources-workspace";
import { getFactoryContext } from "@/lib/factory/context";

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

  // Same gate the panels had under Admin — manager and up.
  if (!canManage) redirect(`/factory/${slug}`);

  // Products was this page's third tab and is its own page now. Kept for
  // links and bookmarks made before the move, like /report is for the shift
  // report.
  if (tab === "products") redirect(`/factory/${slug}/products`);

  // No heading, for Configuration's reason: the rail names the section and
  // each register's panel header names the screen.
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col lg:min-h-0 lg:flex-1">
      <ResourcesWorkspace
        factoryId={factory.id}
        canManage={canManage}
        isAdmin={role === "admin" || role === "super_admin"}
      />
    </div>
  );
}
