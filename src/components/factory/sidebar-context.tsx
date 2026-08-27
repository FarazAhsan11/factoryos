"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

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
    () => ({ collapsed, toggleCollapsed, mobileOpen, setMobileOpen, mounted }),
    [collapsed, toggleCollapsed, mobileOpen, mounted],
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
