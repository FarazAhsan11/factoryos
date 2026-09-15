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
    /* Fills the workspace frame from `lg` up rather than growing the page —
       see the note on <main> in FactoryShell. That is what gives each board
       column a bounded height to scroll inside. */
    <div className="mx-auto w-full max-w-[1500px] lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <PipelineWorkspace
        factoryId={factory.id}
        userId={user.id}
        units={unitWords(factory)}
        batchModel={factory.batch_model}
        workOrderMode={factory.work_order_mode}
        canManage={canManage}
      />
    </div>
  );
}
