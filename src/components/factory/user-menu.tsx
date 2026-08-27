"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, MoreVertical } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The signed-in viewer, at the right end of the workspace top bar: avatar,
 * name, role, and the actions that belong to the account behind a kebab.
 *
 * Sign out used to be a permanent button in the chrome — a destructive-ish
 * action given the same weight as the shift clock. It lives in this menu now,
 * which is also where anything else account-shaped (profile, preferences)
 * will land without growing the bar.
 */
export function UserMenu({
  name,
  email,
  roleLabel,
}: {
  name: string | null;
  email: string;
  roleLabel: string;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const display = name?.trim() || email;

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex items-center gap-2.5 rounded-full border border-transparent py-1 pr-1.5 pl-1 transition hover:border-[#E6EAF1] hover:bg-white hover:shadow-[0_2px_10px_-6px_rgba(15,27,52,0.4)] data-popup-open:border-[#E6EAF1] data-popup-open:bg-white sm:pr-2"
      >
        <Avatar label={display} />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[10rem] truncate text-sm leading-tight font-semibold text-[#0F1B34]">
            {display}
          </span>
          <span className="block text-[11px] leading-tight text-[#94A3B8]">
            {roleLabel}
          </span>
        </span>
        <MoreVertical className="size-4 shrink-0 text-[#94A3B8]" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar label={display} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#0F1B34]">
              {display}
            </p>
            <p className="truncate text-xs text-[#94A3B8]">{email}</p>
          </div>
        </div>
        <div className="px-2 pb-2">
          <span className="inline-flex items-center rounded-full bg-[#EFF4FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
            {roleLabel}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          // Stays open while the request is in flight, so the item can show
          // it is working instead of vanishing mid-sign-out.
          closeOnClick={false}
          onClick={() => void signOut()}
          disabled={signingOut}
          variant="destructive"
        >
          {signingOut ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LogOut className="size-4" />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Initials on the same blue the active nav item uses — one accent, reused. */
function Avatar({ label, className }: { label: string; className?: string }) {
  const initials = label
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#2563EB] to-[#4F86F7] text-xs font-bold tracking-wide text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,0.8)]",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
