import { Building2 } from "lucide-react";

/**
 * Shown over the dashboard to non-admin members while the factory's admin
 * still has to complete the onboarding wizard.
 */
export function SetupPending({ factoryName }: { factoryName: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 text-center shadow-[0_30px_80px_-20px_rgba(20,22,43,0.5)]">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Building2 className="size-6" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink">
          {factoryName} is still being set up
        </h1>
        <p className="mt-1.5 text-sm text-ink-4">
          Your factory admin needs to finish onboarding before the dashboard
          opens. Check back shortly.
        </p>
      </div>
    </div>
  );
}
