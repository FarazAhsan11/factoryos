import type { Metadata } from "next";

import { CapaPage } from "@/components/factory/capa/capa-page";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "CAPA · FactoryOS",
};

/**
 * One CAPA, on a page of its own — CAPA plan → Do → Effectiveness check →
 * Closed (0073). The CAPA is read from the register's cached list on the
 * client, so the route only passes who is looking; RLS decides the rest.
 */
export default async function CapaRoute({
  params,
}: {
  params: Promise<{ slug: string; capaId: string }>;
}) {
  const { slug, capaId } = await params;
  const { factory, role, viewer } = await getFactoryContext(slug);

  return (
    <CapaPage
      factoryId={factory.id}
      slug={slug}
      capaId={capaId}
      role={role}
      viewerName={viewer.fullName ?? viewer.email}
    />
  );
}
