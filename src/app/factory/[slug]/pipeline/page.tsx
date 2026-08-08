import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PipelineWorkspace } from "@/components/factory/pipeline/pipeline-workspace";
import { getFactoryContext, unitWords } from "@/lib/factory/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Pipeline · FactoryOS",
};

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, canManage } = await getFactoryContext(slug);

  // The board is readable by everyone in the factory — an operator should see
  // what is running. Only `canManage` adds or removes a job, and RLS is what
  // actually enforces that.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-[1400px]">
      <PipelineWorkspace
        factoryId={factory.id}
        userId={user.id}
        units={unitWords(factory)}
        canManage={canManage}
      />
    </div>
  );
}
