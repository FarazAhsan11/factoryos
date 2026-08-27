import { FactoryShell } from "@/components/factory/factory-shell";
import { OnboardingWizard } from "@/components/factory/onboarding-wizard";
import { SetupPending } from "@/components/factory/setup-pending";
import { getFactoryContext } from "@/lib/factory/context";

export default async function FactoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { factory, role, viewer } = await getFactoryContext(slug);

  // First-run setup gates the whole workspace, not just the dashboard.
  const onboarding = !factory.onboarded_at ? (
    role === "admin" || role === "super_admin" ? (
      <OnboardingWizard factoryId={factory.id} factoryName={factory.name} />
    ) : (
      <SetupPending factoryName={factory.name} />
    )
  ) : null;

  return (
    <>
      <FactoryShell factory={factory} role={role} viewer={viewer}>
        {children}
      </FactoryShell>
      {onboarding}
    </>
  );
}
