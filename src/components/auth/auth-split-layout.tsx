import type { ReactNode } from "react";

import { AuthHero } from "@/components/auth/auth-hero";
import { Logo } from "@/components/brand/logo";

/**
 * Split-screen shell for auth pages (login, signup, forgot-password):
 * brand hero on the left, a centered form column on the right. Fills exactly
 * one viewport on desktop and stacks to the form-only column on mobile.
 */
export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-svh w-full overflow-hidden bg-white lg:h-svh">
      <AuthHero />

      <section className="relative flex w-full flex-col justify-center overflow-y-auto px-6 py-8 sm:px-12 lg:w-[43%] lg:px-16 lg:py-8 xl:px-24">
        {/* diagonal white wedge that bites into the hero */}
        <div
          aria-hidden
          className="absolute inset-y-0 -left-24 hidden w-24 bg-white lg:block"
          style={{ clipPath: "polygon(55% 0,100% 0,100% 100%,0 100%)" }}
        />

        <div className="relative z-10 mx-auto w-full max-w-sm">
          {/* logo on mobile (hero is hidden) */}
          <div className="mb-10 lg:hidden">
            <Logo className="h-8" />
          </div>

          {children}
        </div>
      </section>
    </main>
  );
}
