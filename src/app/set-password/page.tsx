import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export const metadata: Metadata = {
  title: "Set password · FactoryOS",
  description: "Activate your FactoryOS Factory Admin account.",
};

export default function SetPasswordPage() {
  return (
    <AuthSplitLayout>
      {/* SetPasswordForm reads `next` via useSearchParams — needs a Suspense boundary. */}
      <Suspense>
        <SetPasswordForm />
      </Suspense>
    </AuthSplitLayout>
  );
}
