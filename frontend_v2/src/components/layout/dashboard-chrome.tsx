"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "tp.dashboard.sidebar.pinned";

type DashboardChromeContextValue = {
  isPinned: boolean;
  isHovering: boolean;
  isExpanded: boolean;
  setHovering: (value: boolean) => void;
  togglePinned: () => void;
  openPinned: () => void;
  closePinned: () => void;
};

const DashboardChromeContext = createContext<DashboardChromeContextValue | null>(null);

export function DashboardChromeProvider({ children }: { children: React.ReactNode }) {
  const [isPinned, setIsPinned] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setIsPinned(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, isPinned ? "true" : "false");
  }, [isPinned]);

  const setHovering = useCallback((value: boolean) => {
    setIsHovering(value);
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
      isExpanded: isPinned || isHovering,
      setHovering,
      togglePinned,
      openPinned,
      closePinned,
    }),
    [closePinned, isHovering, isPinned, openPinned, setHovering, togglePinned],
  );

  return <DashboardChromeContext.Provider value={value}>{children}</DashboardChromeContext.Provider>;
}

export function useDashboardChrome() {
  const context = useContext(DashboardChromeContext);
  if (!context) {
    throw new Error("useDashboardChrome must be used inside DashboardChromeProvider");
  }
  return context;
}
