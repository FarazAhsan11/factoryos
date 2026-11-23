import type { Metadata } from "next";

import { DeviationCasePage } from "@/components/factory/deviations/deviation-case-page";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Case · FactoryOS",
};

/**
 * One deviation, as a page (it was the case dialog). The case is read from
 * the register's cached list on the client, so the route only passes who is
 * looking; RLS decides what they may read and write.
 */
export default async function DeviationCaseRoute({
  params,
}: {
  params: Promise<{ slug: string; caseId: string }>;
}) {
  const { slug, caseId } = await params;
  const { factory, role, viewer } = await getFactoryContext(slug);

  return (
    <DeviationCasePage
      factoryId={factory.id}
      slug={slug}
      caseId={caseId}
      role={role}
      userId={viewer.id}
      viewerName={viewer.fullName ?? viewer.email}
    />
  );
}
