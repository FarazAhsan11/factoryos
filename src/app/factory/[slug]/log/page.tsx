import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LogWorkspace } from "@/components/factory/log/log-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";
import { resolveLogTab } from "@/lib/factory/log-tabs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Shift log · FactoryOS",
};

export default async function ShiftLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const { factory, canManage, role } = await getFactoryContext(slug);

  // Everyone in the factory logs entries, so there's no role gate here — but
  // the insert is stamped with the signed-in user, which RLS checks.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The Kaizen form shows who an idea will be credited to instead of asking
  // for a name. Read here rather than in the client so the panel doesn't
  // render "Submitted as …" empty for a moment on every open.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const userName =
    profile?.full_name?.trim() ||
    profile?.email?.split("@")[0] ||
    "your account";

  // Wider than `canManage` on purpose: reviewing improvement ideas is the
  // supervisor's job, and routing every one through an admin is how a queue
  // stops moving. Mirrors `can_review_factory()` in migration 0019, which is
  // what actually enforces it.
  const canReview =
    role === "super_admin" ||
    role === "admin" ||
    role === "manager" ||
    role === "supervisor";

  return (
    /* Fills the shell's frame rather than growing the document — see the note
       on <main> in FactoryShell. The two panels below then have a real height
       to scroll inside, instead of one page scrollbar dragging both. */
    <div className="mx-auto flex w-full max-w-7xl flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-5 shrink-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-5">
          Shift log
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          Log production entry
        </h1>
        <p className="mt-1 text-sm text-ink-4">
          Entries are audit-protected — correct a mistake with an amendment,
          never a delete.
        </p>
      </div>

      <LogWorkspace
        factoryId={factory.id}
        userId={user.id}
        userName={userName}
        units={unitWords(factory)}
        initialTab={resolveLogTab(tab)}
        canManage={canManage}
        canReview={canReview}
      />
    </div>
  );
}
