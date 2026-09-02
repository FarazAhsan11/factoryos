import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { KaizenWorkspace } from "@/components/factory/kaizen/kaizen-workspace";
import { getFactoryContext } from "@/lib/factory/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Kaizen · FactoryOS",
};

/**
 * Kaizen — the improvement queue.
 *
 * No role gate: anyone on the floor may submit an idea, which is the whole
 * point of it. Reviewing one is supervisor and up (`canReview`), enforced by
 * `can_review_factory()` in migration 0019 rather than by this page.
 */
export default async function KaizenPage({
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

  // The form shows who an idea will be credited to instead of asking for a
  // name. Read here rather than in the client so the panel doesn't render
  // "Submitted as …" empty for a moment on every open.
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
  // stops moving.
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
      <div className="mb-3 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Kaizen
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-4">
          Improvement ideas from the floor. Anyone may raise one; a supervisor
          takes it through review.
        </p>
      </div>

      <KaizenWorkspace
        factoryId={factory.id}
        userId={user.id}
        userName={userName}
        canReview={canReview}
      />
    </div>
  );
}
