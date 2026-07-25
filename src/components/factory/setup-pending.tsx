import { Building2 } from "lucide-react";

/**
 * Shown over the dashboard to non-admin members while the factory's admin
 * still has to complete the onboarding wizard.
 */
export function SetupPending({ factoryName }: { factoryName: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F1B34]/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-[0_30px_80px_-20px_rgba(15,27,52,0.5)]">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#EFF4FF] text-[#2563EB]">
          <Building2 className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-[#0F1B34]">
          {factoryName} is still being set up
        </h1>
        <p className="mt-1.5 text-sm text-[#64748B]">
          Your factory admin needs to finish onboarding before the dashboard
          opens. Check back shortly.
        </p>
      </div>
    </div>
  );
}
