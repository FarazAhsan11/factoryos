import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RaiseDeviationPage } from "@/components/factory/deviations/raise-deviation-page";
import { RaiseNcrPage } from "@/components/factory/deviations/raise-ncr-page";
import { RaiseComplaintPage } from "@/components/factory/deviations/raise-complaint-page";
import { canReview } from "@/lib/factory/action-queries";
import { getFactoryContext } from "@/lib/factory/context";

export const metadata: Metadata = {
  title: "New case · FactoryOS",
};

/**
 * Raise a deviation — or, with `?type=ncr`, a non-conformance — on a page
 * of its own. Supervisor and up, as raising is (`can_review_factory()` on the
 * insert); anyone else is sent back to the register rather than shown a form
 * RLS would refuse.
 */
export default async function NewDeviationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ slug }, { type }] = await Promise.all([params, searchParams]);
  const { factory, role, viewer } = await getFactoryContext(slug);

  if (!canReview(role)) {
    redirect(
      `/factory/${slug}/deviations${type === "ncr" ? "?tab=ncr" : type === "complaint" ? "?tab=complaints" : ""}`,
    );
  }

  if (type === "complaint") {
    return (
      <RaiseComplaintPage
        factoryId={factory.id}
        slug={slug}
        userId={viewer.id}
        viewerName={viewer.fullName ?? viewer.email}
      />
    );
  }

  if (type === "ncr") {
    return (
      <RaiseNcrPage
        factoryId={factory.id}
        slug={slug}
        userId={viewer.id}
        viewerName={viewer.fullName ?? viewer.email}
      />
    );
  }

  return (
    <RaiseDeviationPage
      factoryId={factory.id}
      slug={slug}
      userId={viewer.id}
      viewerName={viewer.fullName ?? viewer.email}
    />
  );
}
