import type { Metadata } from "next";

import { DeviationsWorkspace } from "@/components/factory/deviations/deviations-workspace";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "Quality · FactoryOS",
};

export default async function DeviationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, role, viewer } = await getFactoryContext(slug);

  // The nav keeps this to supervisor and up, and `can_review_factory()` is
  // what actually enforces raising and closing. The role is passed down so the
  // screens can say so rather than letting RLS refuse a typed-out form.
  return (
    <div className="mx-auto w-full max-w-[1600px] lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <DeviationsWorkspace
        factoryId={factory.id}
        slug={slug}
        userId={viewer.id}
        // "Raised by" on a new case and "My cases" — the name, or the login
        // when the profile has none.
        viewerName={viewer.fullName ?? viewer.email}
        role={role}
      />
    </div>
  );
}
