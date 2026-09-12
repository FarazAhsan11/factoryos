import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProductsPanel } from "@/components/factory/admin/products-panel";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Products · FactoryOS",
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
    /* Fills the workspace frame from `lg` up rather than growing the page —
       see the note on <main> in FactoryShell. The panel scrolls inside it,
       so a catalogue of hundreds of batches never grows the shell. The inset
       padding keeps a focus ring from being clipped by the scroll box. */
    <div className="mx-auto flex w-full max-w-6xl flex-col lg:min-h-0 lg:flex-1">
      <div className="scrollbar-slim -mx-1 min-h-0 flex-1 px-1 pb-1 lg:overflow-y-auto">
        <ProductsPanel factoryId={factory.id} canManage={canManage} />
      </div>
    </div>
  );
}
