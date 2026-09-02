import { redirect } from "next/navigation";

/**
 * The Shift report's old home.
 *
 * It is the shift log's second tab now — reading the sheet and correcting an
 * entry are the same job, done minutes apart, and they used to be two clicks
 * and a page load away from each other. This is kept so printed sheets,
 * bookmarks and anything that linked here still land on it.
 */
export default async function ShiftReportRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/factory/${slug}/log?tab=report`);
}
