import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session → sign-in screen.
  if (!user) redirect("/login");

  // Route each role to its home surface.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, factory_id, factories(slug)")
    .eq("id", user.id)
    .single();

  if (profile?.role === "super_admin") redirect("/admin");

  // The embedded relation can come back as an object or a single-item array.
  const rel = profile?.factories as
    { slug: string | null } | { slug: string | null }[] | null | undefined;
  const factory = Array.isArray(rel) ? rel[0] : rel;
  if (profile?.factory_id && factory?.slug) {
    redirect(`/factory/${factory.slug}`);
  }

  // Signed in but not yet assigned to a factory dashboard.
  redirect("/login");
}
