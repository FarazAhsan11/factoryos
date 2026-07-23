import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Plus, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { SignOutButton } from "@/components/auth/sign-out-button";
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
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0F1B34]">
              Factories
            </h1>
            <p className="mt-1 text-sm text-[#64748B]">
              Every tenant on the platform. Create a factory to provision its
              first admin.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06]"
          >
            <Plus className="size-4" />
            Create factory
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-[#E6EAF1] bg-white">
          {!factories || factories.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-[#EFF4FF] text-[#2563EB]">
                <Building2 className="size-6" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-[#0F1B34]">
                No factories yet
              </h2>
              <p className="mt-1 max-w-sm text-sm text-[#64748B]">
                When you create a factory, it appears here along with its admin
                and onboarding status.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#EEF1F6]">
              {factories.map((factory) => (
                <li
                  key={factory.id}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-[#EFF4FF] text-[#2563EB]">
                      <Building2 className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#0F1B34]">
                        {factory.name}
                      </p>
                      {factory.slug && (
                        <p className="text-xs text-[#94A3B8]">{factory.slug}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-[#94A3B8]">
                    {new Date(factory.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
