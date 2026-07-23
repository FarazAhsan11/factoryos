import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  FactoriesConsole,
  type Factory,
} from "@/components/admin/factories-console";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Super Admin · FactoryOS",
};

export default async function AdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", user.id)
    .single();

  // Only the platform owner may see this console.
  if (!profile || profile.role !== "super_admin") redirect("/login");

  const { data: factories } = await supabase
    .from("factories")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-svh bg-[#F6F8FC]">
      {/* top bar */}
      <header className="flex items-center justify-between border-b border-[#E6EAF1] bg-white px-6 py-3.5">
        <div className="flex items-center gap-3">
          <Logo className="h-7" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF4FF] px-2.5 py-1 text-xs font-semibold text-[#2563EB]">
            <ShieldCheck className="size-3.5" />
            Super Admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-[#64748B] sm:inline">
            {profile.full_name ?? profile.email}
          </span>
          <SignOutButton />
        </div>
      </header>

      {/* content */}
      <main className="mx-auto max-w-6xl px-6 py-10">
        <FactoriesConsole factories={(factories as Factory[]) ?? []} />
      </main>
    </div>
  );
}
