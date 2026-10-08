import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProductsPanel } from "@/components/factory/admin/products-panel";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Customer orders · FactoryOS",
};

/**
 * The batch catalogue, on its own page directly under Pipeline in the rail.
 *
 * It was Resources' third tab. It moved because it is not a register like the
 * machines and the people — it is where a batch is raised before the board
 * plans it, and with the customer order on every row (migration 0041) it is
 * a screen someone works in, not one they look a name up on.
 */
export default async function FactoryProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, canManage } = await getFactoryContext(slug);

  // The same gate it had under Resources, and under Admin before that.
  if (!canManage) redirect(`/factory/${slug}`);

  return (
    /* Fills the workspace frame from `lg` up rather than growing the page:
       the table then has a bounded box to scroll inside, which is what makes
       its header row stay put. Wide, like the data table — every field is a
       column and the rest is white space. */
    <div className="mx-auto flex w-full max-w-[1600px] flex-col lg:min-h-0 lg:flex-1">
      <ProductsPanel factoryId={factory.id} canManage={canManage} />
    </div>
  );
}
