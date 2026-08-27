"use client";

import { Menu } from "lucide-react";

import { useSidebar } from "@/components/factory/sidebar-context";

/**
 * Opens the navigation drawer. Below `lg` only — from there up the rail is
 * always on screen and collapses from its own footer instead.
 */
export function SidebarMenuButton() {
  const { setMobileOpen } = useSidebar();

  return (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label="Open navigation"
      className="-ml-1 grid size-9 place-items-center rounded-lg text-ink-3 transition hover:bg-brand-soft hover:text-brand lg:hidden"
    >
      <Menu className="size-5" />
    </button>
  );
}
