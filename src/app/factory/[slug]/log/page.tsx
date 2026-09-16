import type { Metadata } from "next";

import { LogWorkspace } from "@/components/factory/log/log-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";
import { resolveLogTab, resolveLogView } from "@/lib/factory/log-tabs";

export const metadata: Metadata = {
  title: "Shift log · FactoryOS",
};

export default async function ShiftLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; view?: string }>;
}) {
  const { slug } = await params;
  const { tab, view } = await searchParams;
  const { factory, canManage, role, viewer } = await getFactoryContext(slug);

  // Everyone in the factory logs entries, so there's no role gate here — but
  // the insert is stamped with the signed-in user, which RLS checks. The
  // viewer comes from the factory context, which has already asked Supabase
  // Auth who this is; asking again here was a second round trip per visit.

  // Decides whether the Shift report tab exists at all: the report is the
  // handover document — every room side by side rather than the operator's
  // own entries — so it stays supervisor and up, exactly as it was when it
  // had its own nav item.
  const canReview =
    role === "super_admin" ||
    role === "admin" ||
    role === "manager" ||
    role === "supervisor";

  return (
    /* Fills the shell's frame rather than growing the document — see the note
       on <main> in FactoryShell. The panels below then have a real height to
       scroll inside, instead of one page scrollbar dragging both.

       There is no heading: the tab strip is the first thing on the screen,
       and the max width lives in the workspace because it belongs to the open
       tab, which a tab switch never comes back here to change. */
    <div className="flex w-full flex-col lg:min-h-0 lg:flex-1">
      <LogWorkspace
        factoryId={factory.id}
        factoryName={factory.name}
        userId={viewer.id}
        units={unitWords(factory)}
        initialTab={resolveLogTab(tab, canReview)}
        initialView={resolveLogView(view)}
        canManage={canManage}
        canReview={canReview}
      />
    </div>
  );
}
