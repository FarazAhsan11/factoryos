import { Logo } from "@/components/brand/logo";

/**
 * Left-hand brand panel for auth screens: logo, isometric factory
 * illustration, and a tagline. Hidden below `lg`.
 */
export function AuthHero() {
  return (
    <section className="relative hidden flex-col overflow-hidden bg-[linear-gradient(135deg,#F5F8FC_0%,#EAF0FA_55%,#FFFFFF_100%)] lg:flex lg:w-[57%]">
      {/* faint blueprint grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(#DCE4F0 1px,transparent 1px),linear-gradient(90deg,#DCE4F0 1px,transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage:
            "radial-gradient(120% 120% at 30% 30%,#000 40%,transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(120% 120% at 30% 30%,#000 40%,transparent 80%)",
        }}
      />

      <div className="relative z-10 p-10">
        <Logo className="h-12" />
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/branding/login-hero.svg"
          alt="Isometric factory floor with conveyor and delivery truck"
          className="w-full max-w-140 drop-shadow-[0_30px_50px_rgba(37,99,235,0.10)]"
        />
      </div>

      <div className="relative z-10 max-w-md p-10">
        <h2 className="text-2xl font-medium leading-snug tracking-tight text-[#0F1B34]">
          Production intelligence for shift teams.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#5B6B85]">
          Pipeline, OEE, quality and shift handovers in one workspace for every
          factory, every shift.
        </p>
      </div>
    </section>
  );
}
