import type { Metadata } from "next";

import { ShiftReportWorkspace } from "@/components/factory/report/shift-report-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Shift report · FactoryOS",
};

/**
 * Shift Report — the whole floor for one shift, on one sheet.
 *
 * Supervisor and up, matching the nav: this is the handover document, and it
 * shows every room's output side by side rather than the operator's own
 * entries.
 */
export default async function ShiftReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory } = await getFactoryContext(slug);

  return (
    <div className="mx-auto max-w-[1400px]">
      <ShiftReportWorkspace
        factoryId={factory.id}
        factoryName={factory.name}
        units={unitWords(factory)}
      />
    </div>
  );
}
