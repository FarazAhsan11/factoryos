import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BatchRecordWorkspace } from "@/components/factory/batch/batch-record-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Batch record · FactoryOS",
};

/**
 * Factory → Batch record.
 *
 * No role gate beyond the nav's. The screen writes nothing — it gathers what
 * three other modules already recorded about one batch — and RLS scopes every
 * one of those reads to the tenant. The role is passed down only so the two
 * detail dialogs opened from here behave exactly as they do on their own
 * screens; `can_review_factory()` and the stage triggers decide what anyone
 * may actually change.
 */
export default async function BatchRecordPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, role } = await getFactoryContext(slug);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    /* Fills the workspace frame from `lg` up rather than growing the page, so
       the search box and the tab strip stay put while what is under them
       scrolls — see the note on <main> in FactoryShell. Wider than the other
       list screens because the Activity tab is a ten-column table; the cards
       under Issues and Maintenance are happy either way. */
    <div className="mx-auto w-full max-w-6xl lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <BatchRecordWorkspace
        factoryId={factory.id}
        userId={user.id}
        role={role}
        units={unitWords(factory)}
      />
    </div>
  );
}
