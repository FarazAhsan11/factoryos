import type { Metadata } from "next";

import { FloorWorkspace } from "@/components/factory/floor/floor-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Floor status · FactoryOS",
};

export default async function FloorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory } = await getFactoryContext(slug);

  // Read-only and open to everyone: what each room is doing is asked by
  // whoever is walking the floor. It writes nothing.
  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <FloorWorkspace factoryId={factory.id} unitWords={unitWords(factory)} />
    </div>
  );
}
