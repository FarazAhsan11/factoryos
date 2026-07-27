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
  const { factory } = await getFactoryContext(slug);

  // Everyone in the factory logs entries, so there's no role gate here — but
  // the insert is stamped with the signed-in user, which RLS checks.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
          Shift log
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0F1B34]">
          Log production entry
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">
          Entries are audit-protected — correct a mistake with an amendment,
          never a delete.
        </p>
      </div>

      <LogWorkspace
        factoryId={factory.id}
        userId={user.id}
        units={unitWords(factory)}
        initialTab={resolveLogTab(tab)}
      />
    </div>
  );
}
