import type { Metadata } from "next";

import { ActionsWorkspace } from "@/components/factory/actions/actions-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Actions · FactoryOS",
};

export default async function ActionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, role, viewer } = await getFactoryContext(slug);

  // No role gate beyond the nav's: an issue is collaborative work, and the
  // person who can fix a thing isn't always a manager. RLS scopes it to the
  // tenant either way. The role is passed down for one decision only — who
  // gets the sign-off form — and `can_review_factory()` enforces it for real.
  return (
    /* Fills the workspace frame from `lg` up rather than growing the page —
       see the note on <main> in FactoryShell. The stage tabs then stay put
       while the queue under them scrolls, which is the whole point of tabs
       that carry counts. */
    <div className="mx-auto w-full max-w-5xl lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <ActionsWorkspace
        factoryId={factory.id}
        userId={viewer.id}
        role={role}
        units={unitWords(factory)}
      />
    </div>
  );
}
