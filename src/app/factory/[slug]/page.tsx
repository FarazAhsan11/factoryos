import type { Metadata } from "next";

import { FactoryDashboard } from "@/components/factory/factory-dashboard";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Factory dashboard · FactoryOS",
};

export default async function FactoryDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory } = await getFactoryContext(slug);

  return <FactoryDashboard factory={factory} />;
}
