import { Building2 } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { FactorySidebar } from "@/components/factory/factory-sidebar";
import { ShiftIndicator } from "@/components/factory/shift-indicator";
import type { FactoryContext } from "@/lib/factory/context";

const ROLE_LABELS: Record<FactoryContext["role"], string> = {
  super_admin: "Super Admin",
  admin: "Factory Admin",
  manager: "Manager",
  supervisor: "Supervisor",
  operator: "Operator",
};

/**
 * Chrome shared by every /factory/[slug] route: top bar with the tenant's
 * identity and the role-gated left rail. Pages render inside <main>.
 */
export function FactoryShell({
  factory,
  role,
  children,
}: {
  factory: FactoryContext["factory"];
  role: FactoryContext["role"];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-[#F6F8FC]">
      {/* The workspace chrome is navigation, and navigation is meaningless on
          paper. The shift report prints; the rail and the top bar don't. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#E6EAF1] bg-white px-6 py-3.5 print:hidden">
        <div className="flex items-center gap-3">
          {factory.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={factory.logo_url}
              alt=""
              className="size-9 rounded-lg object-cover"
            />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#EFF4FF] text-[#2563EB]">
              <Building2 className="size-5" />
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-[#0F1B34]">
              {factory.name}
            </p>
            <p className="text-xs text-[#94A3B8]">
              {factory.slug ?? "factory"} · workspace
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Workspace-wide context, so it lives in the workspace chrome: the
              feed, the data table and the entry form are all read against the
              running shift, and none of them owns it. Hidden on narrow screens
              — the tenant identity and Sign out win that space. */}
          <ShiftIndicator factoryId={factory.id} className="hidden md:flex" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF4FF] px-2.5 py-1 text-xs font-semibold text-[#2563EB]">
            {ROLE_LABELS[role]}
          </span>
          <SignOutButton />
        </div>
      </header>

      <div className="lg:flex">
        <div className="print:hidden">
          <FactorySidebar slug={factory.slug ?? ""} role={role} />
        </div>
        <main className="min-w-0 flex-1 px-6 py-8 print:px-0 print:py-0">
          {children}
        </main>
      </div>
    </div>
  );
}
