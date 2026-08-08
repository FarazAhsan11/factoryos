import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActionsWorkspace } from "@/components/factory/actions/actions-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Actions · FactoryOS",
};

export default async function ActionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory } = await getFactoryContext(slug);

  // No role gate beyond the nav's: an action is collaborative work, and the
  // person who can fix a thing isn't always a manager. RLS scopes it to the
  // tenant either way.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-4xl">
      <ActionsWorkspace
        factoryId={factory.id}
        userId={user.id}
        units={unitWords(factory)}
      />
    </div>
  );
}
