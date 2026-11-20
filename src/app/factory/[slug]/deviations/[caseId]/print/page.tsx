import type { Metadata } from "next";

import { DeviationReport } from "@/components/factory/deviations/deviation-report";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Deviation report · FactoryOS",
};

/**
 * A deviation's printable report — every section of the case on one page,
 * printed or saved as a PDF by the browser. Like the case page, the case is
 * read from the register's cached list on the client; RLS decides what the
 * viewer may read.
 */
export default async function DeviationReportRoute({
  params,
}: {
  params: Promise<{ slug: string; caseId: string }>;
}) {
  const { slug, caseId } = await params;
  const { factory, viewer } = await getFactoryContext(slug);

  return (
    <DeviationReport
      factoryId={factory.id}
      factoryName={factory.name}
      slug={slug}
      caseId={caseId}
      viewerName={viewer.fullName ?? viewer.email}
    />
  );
}
