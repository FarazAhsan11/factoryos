import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RaiseDeviationPage } from "@/components/factory/deviations/raise-deviation-page";
import { canReview } from "@/lib/factory/action-queries";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "New deviation · FactoryOS",
};

/**
 * Raise a deviation — the page that replaced the modal. Supervisor and up,
 * as raising is (`can_review_factory()` on the insert); anyone else is sent
 * back to the register rather than shown a form RLS would refuse.
 */
export default async function NewDeviationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, role, viewer } = await getFactoryContext(slug);

  if (!canReview(role)) redirect(`/factory/${slug}/deviations`);

  return (
    <RaiseDeviationPage
      factoryId={factory.id}
      slug={slug}
      userId={viewer.id}
      viewerName={viewer.fullName ?? viewer.email}
    />
  );
}
