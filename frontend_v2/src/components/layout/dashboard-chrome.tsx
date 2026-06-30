"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "tp.dashboard.sidebar.pinned.v4";
const LEGACY_STORAGE_KEYS = [
  "tp.dashboard.sidebar.pinned",
  "tp.dashboard.sidebar.pinned.v2",
  "tp.dashboard.sidebar.pinned.v3",
];

type DashboardChromeContextValue = {
  isPinned: boolean;
  isHovering: boolean;
  isExpanded: boolean;
  setHovering: (value: boolean) => void;
  togglePinned: () => void;
  openPinned: () => void;
  closePinned: () => void;
};

const DashboardChromeContext =
  createContext<DashboardChromeContextValue | null>(null);

export function DashboardChromeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isPinned, setIsPinned] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setIsPinned(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, isPinned ? "true" : "false");
  }, [isPinned]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const setHovering = useCallback((value: boolean) => {
    // Sidebar expansion is manual-only; hover state is kept in context for
    // backwards compatibility with older callers but no longer opens the nav.
    setIsHovering(false);
    if (!value) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const togglePinned = useCallback(() => {
    setIsPinned((current) => !current);
  }, []);

  const openPinned = useCallback(() => {
    setIsPinned(true);
  }, []);

  const closePinned = useCallback(() => {
    setIsPinned(false);
  }, []);

  const value = useMemo<DashboardChromeContextValue>(
    () => ({
      isPinned,
      isHovering,
      isExpanded: isPinned,
      setHovering,
      togglePinned,
      openPinned,
      closePinned,
    }),
    [closePinned, isHovering, isPinned, openPinned, setHovering, togglePinned],
  );

  return (
    <DashboardChromeContext.Provider value={value}>
      {children}
    </DashboardChromeContext.Provider>
  );
}

export function useDashboardChrome() {
  const context = useContext(DashboardChromeContext);
  if (!context) {
    throw new Error(
      "useDashboardChrome must be used inside DashboardChromeProvider",
    );
  }
  return context;
}
