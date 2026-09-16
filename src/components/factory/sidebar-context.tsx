"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "factoryos:sidebar-collapsed";

/* The collapse preference lives in localStorage, which makes it an external
   store rather than React state — so it is read with `useSyncExternalStore`
   instead of an effect that copies it into state after mount. That keeps the
   server snapshot (expanded) honest and lets a write notify every rail on the
   page, including another tab. */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // private mode / blocked storage — the default stands
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* the preference simply doesn't persist */
  }
  listeners.forEach((listener) => listener());
}

/** Server and first client render agree on "expanded"; the store corrects it. */
const serverCollapsed = () => false;

/** True only after hydration — what gates the rail's width transition. */
const noopSubscribe = () => () => {};
const hydratedClient = () => true;
const hydratedServer = () => false;

interface SidebarState {
  /** Desktop rail collapsed to icons only. Persisted per browser. */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Mobile off-canvas drawer. Never persisted — always starts closed. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  /** False until after hydration, so the rail doesn't animate its own restore. */
  mounted: boolean;
  /**
   * Where a rail click is taking the workspace, for as long as it is on the
   * way — null otherwise. The rail highlights it and the page area shows its
   * skeleton straight away, rather than both waiting on the server.
   */
  pendingHref: string | null;
  /** Navigate from the rail. */
  navigate: (href: string) => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

/**
 * Holds the two independent open/closed states the workspace chrome needs:
 * the desktop collapse (sticky, a user preference) and the mobile drawer
 * (transient — every control that navigates closes it on the way out).
 */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const collapsed = useSyncExternalStore(
    subscribe,
    readCollapsed,
    serverCollapsed,
  );
  const mounted = useSyncExternalStore(
    noopSubscribe,
    hydratedClient,
    hydratedServer,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  /* Rail navigation lives here, not in the rail, because two places answer
     to it: the rail's highlight and the page area's placeholder. Both read
     the same pending destination, so they change in the same frame. */
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const navigate = useCallback(
    (href: string) => {
      setTarget(href);
      startTransition(() => router.push(href));
    },
    [router],
  );
  // Only while the transition runs: once the route commits, the real
  // pathname takes over and there is no stale destination to clear.
  const pendingHref = isPending ? target : null;

  // While the drawer is over the page, the page underneath must not scroll.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const toggleCollapsed = useCallback(() => {
    writeCollapsed(!readCollapsed());
  }, []);

  const value = useMemo(
    () => ({
      collapsed,
      toggleCollapsed,
      mobileOpen,
      setMobileOpen,
      mounted,
      pendingHref,
      navigate,
    }),
    [collapsed, toggleCollapsed, mobileOpen, mounted, pendingHref, navigate],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarState {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used inside <SidebarProvider>");
  }
  return context;
}
