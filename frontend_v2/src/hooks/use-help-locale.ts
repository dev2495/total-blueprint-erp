"use client";

import { useEffect, useState } from "react";
import type { HelpLocale } from "@/help/types";

const STORAGE_KEY = "tbp_help_locale";

export function useHelpLocale() {
  const [locale, setLocale] = useState<HelpLocale>("en");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "hi") {
        setLocale(saved);
      }
    } catch {
      // no-op: localStorage unavailable
    }
  }, []);

  const updateLocale = (next: HelpLocale) => {
    setLocale(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // no-op: localStorage unavailable
    }
  };

  return { locale, setLocale: updateLocale };
}
