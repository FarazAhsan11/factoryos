import { FactorySidebar } from "@/components/factory/factory-sidebar";
import { ShiftIndicator } from "@/components/factory/shift-indicator";
import { SidebarMenuButton } from "@/components/factory/sidebar-menu-button";
import { SidebarProvider } from "@/components/factory/sidebar-context";
import { UserMenu } from "@/components/factory/user-menu";
import type { FactoryContext } from "@/lib/factory/context";

const ROLE_LABELS: Record<FactoryContext["role"], string> = {
  super_admin: "Super Admin",
  admin: "Factory Admin",
  manager: "Manager",
  supervisor: "Supervisor",
  operator: "Operator",
};

/**
 * Chrome shared by every /factory/[slug] route.
 *
 * The rail runs the full height of the window and the top bar starts where the
 * rail ends, so the tenant's identity is stated once — at the top of the rail —
 * and the bar is free to be what it actually is: the running shift on the left,
 * the account on the right. Pages render inside <main>.
 */
export function FactoryShell({
  factory,
  role,
  viewer,
  children,
}: {
  factory: FactoryContext["factory"];
  role: FactoryContext["role"];
  viewer: FactoryContext["viewer"];
  children: React.ReactNode;
}) {
  return (
    /* An app layout from `lg` up: the viewport is the frame, and scrolling
       happens *inside* it rather than to it. That is what lets a page fill the
       screen and give its table a bounded box to scroll in — a sticky table
       header only sticks to the element that scrolls, so while the document
       was the scroller the `sticky top-0` on `<thead>` did nothing.

       Below `lg` the document scrolls as before, and the rail is a drawer
       floating over it rather than a column beside it. Print is exempt for the
       same reason — a fixed-height frame would print exactly one screen of a
       report. */
    <SidebarProvider>
      <div className="bg-canvas max-lg:min-h-svh lg:flex lg:h-svh lg:overflow-hidden print:block print:h-auto print:overflow-visible">
        <FactorySidebar
          slug={factory.slug ?? ""}
          role={role}
          factoryName={factory.name}
          logoUrl={factory.logo_url}
        />

        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          {/* The workspace chrome is navigation, and navigation is meaningless
              on paper. The shift report prints; the rail and the bar don't. */}
          <header className="sticky top-0 z-30 flex h-[3.75rem] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-sm sm:px-6 print:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarMenuButton />
              {/* Identity below `lg` only: from there up the rail carries it,
                  and two copies of one logo in a corner is just noise. */}
              <p className="truncate text-sm font-semibold text-ink lg:hidden">
                {factory.name}
              </p>
              {/* Workspace-wide context, so it lives in the workspace chrome:
                  the feed, the data table and the entry form are all read
                  against the running shift, and none of them owns it. */}
              <ShiftIndicator
                factoryId={factory.id}
                className="hidden md:flex"
              />
            </div>

            <UserMenu
              name={viewer.fullName}
              email={viewer.email}
              roleLabel={ROLE_LABELS[role]}
            />
          </header>

          {/* `<main>` is the scroll container from `lg` up. Ordinary pages
              overflow it and scroll exactly as they did; a page that wants the
              viewport instead makes its own root `lg:min-h-0 lg:flex-1`, fills
              the space and scrolls internally. No prop, no route-sniffing —
              the page decides by how it sizes itself. */}
          <main className="min-w-0 flex-1 px-6 py-8 lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto print:overflow-visible print:px-0 print:py-0">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
